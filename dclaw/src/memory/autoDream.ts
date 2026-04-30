import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { executeSingleTurn } from '../core/queryLoop.js'
import type { QueryTraceSink } from '../core/queryTrace.js'
import type { LlmClient } from '../llm/types.js'
import { listSessionMetas } from '../session/history.js'
import {
  createTextMessage,
  createTranscriptOnlyTextMessage,
  getTextContent,
  getToolUseBlocks,
  type Message,
} from '../types/message.js'
import type { ToolContext } from '../types/tool.js'
import { loadMemoryManifest } from './manifest.js'
import {
  getMemoryConsolidationLockPath,
  getMemoryConsolidationStatePath,
  getMemoryDir,
  getMemoryEntrypointPath,
} from './paths.js'
import {
  createMemoryToolRegistry,
} from './extract.js'
import { ensureMemoryScaffold } from './store.js'

const AUTO_DREAM_MAX_TURNS = 8
const AUTO_DREAM_DRAIN_TIMEOUT_MS = 60_000

export type AutoDreamConfig = {
  enabled?: boolean
  minHours?: number
  minSessions?: number
}

export type AutoDreamRunState = {
  currentSessionId?: string
  queryTraceSink?: QueryTraceSink
}

type AutoDreamStateFile = {
  lastConsolidatedAt?: string
}

export type AutoDreamRunResult =
  | {
      triggered: false
      reason:
        | 'disabled'
        | 'min_hours'
        | 'min_sessions'
        | 'lock_held'
        | 'no_changes'
    }
  | {
      triggered: true
      touchedSessionCount: number
      changedMemoryPaths: string[]
      note: Message
    }

function getNowIso(): string {
  return new Date().toISOString()
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function getConfig(input?: AutoDreamConfig): Required<AutoDreamConfig> {
  return {
    enabled: input?.enabled ?? true,
    minHours: input?.minHours ?? 24,
    minSessions: input?.minSessions ?? 3,
  }
}

async function readAutoDreamState(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<AutoDreamStateFile> {
  try {
    return JSON.parse(
      await readFile(getMemoryConsolidationStatePath(workspaceRoot, env), 'utf8'),
    ) as AutoDreamStateFile
  } catch {
    return {}
  }
}

async function writeAutoDreamState(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  state: AutoDreamStateFile,
): Promise<void> {
  await writeFile(
    getMemoryConsolidationStatePath(workspaceRoot, env),
    JSON.stringify(state, null, 2) + '\n',
    'utf8',
  )
}

async function acquireAutoDreamLock(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<(() => Promise<void>) | null> {
  const lockPath = getMemoryConsolidationLockPath(workspaceRoot, env)
  try {
    await mkdir(lockPath)
  } catch {
    return null
  }

  return async () => {
    await rm(lockPath, { recursive: true, force: true })
  }
}

function buildConsolidationPrompt(input: {
  memoryDir: string
  entrypointPath: string
  touchedSessionCount: number
  sessionSummaries: string[]
  manifestLines: string[]
}): string {
  return [
    'You are the memory consolidation forked agent.',
    'Your task is to improve durable workspace memory based on recent completed sessions.',
    '',
    `Memory directory: ${input.memoryDir}`,
    `Memory entrypoint: ${input.entrypointPath}`,
    `Touched sessions: ${input.touchedSessionCount}`,
    'Available tools: Read, Edit, Write, DeleteMemory.',
    '',
    'Rules:',
    '- Work only inside the memory directory.',
    '- Consolidate duplicate or overlapping memory files.',
    '- Remove stale or contradicted memory only when the session summaries clearly support it.',
    '- Keep MEMORY.md as a short index with no orphan links.',
    '- Do not save ordinary transcript summaries, task progress, code facts, or file lists.',
    '- If no durable improvement is needed, answer briefly without tool calls.',
    '',
    'Existing memory files:',
    ...(input.manifestLines.length > 0 ? input.manifestLines : ['- none']),
    '',
    'Recent touched sessions:',
    ...input.sessionSummaries,
  ].join('\n')
}

function extractChangedMemoryPaths(messages: Message[], memoryDir: string): string[] {
  const pendingToolPaths = new Map<string, string>()
  const changed = new Set<string>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const block of getToolUseBlocks(message)) {
        if (
          block.name !== 'Edit' &&
          block.name !== 'Write' &&
          block.name !== 'DeleteMemory'
        ) {
          continue
        }
        const input = block.input as { file_path?: unknown; path?: unknown }
        const filePath =
          typeof input.file_path === 'string'
            ? input.file_path
            : typeof input.path === 'string'
              ? input.path
              : undefined
        if (!filePath || !filePath.startsWith(memoryDir)) {
          continue
        }
        pendingToolPaths.set(block.id, filePath)
      }
      continue
    }

    for (const block of message.content) {
      if (block.type !== 'tool_result') {
        continue
      }
      const filePath = pendingToolPaths.get(block.toolUseId)
      if (!filePath) {
        continue
      }
      if (
        typeof block.output === 'object' &&
        block.output !== null &&
        'error' in block.output
      ) {
        continue
      }
      if (basename(filePath) !== 'MEMORY.md') {
        changed.add(filePath)
      }
    }
  }

  return [...changed].sort((left, right) => left.localeCompare(right))
}

function formatImprovedMemoryNote(paths: string[]): Message {
  return createTranscriptOnlyTextMessage(
    'system',
    [
      `Improved ${paths.length} memory ${paths.length === 1 ? 'file' : 'files'} through autoDream:`,
      ...paths.map(path => `- ${path}`),
    ].join('\n'),
  )
}

export function createAutoDream(input: {
  client: LlmClient
  model?: string
  workspaceRoot: string
  env?: NodeJS.ProcessEnv
  config?: AutoDreamConfig
}) {
  let inProgress: Promise<Message[]> | undefined

  async function runAutoDream(
    state: AutoDreamRunState = {},
  ): Promise<AutoDreamRunResult> {
    const env = input.env ?? process.env
    const config = getConfig(input.config)
    if (!config.enabled) {
      return { triggered: false, reason: 'disabled' }
    }

    await ensureMemoryScaffold(input.workspaceRoot, env)
    const persistedState = await readAutoDreamState(input.workspaceRoot, env)
    const lastConsolidatedMs = parseTimestamp(persistedState.lastConsolidatedAt)
    const nowMs = Date.now()
    if (
      lastConsolidatedMs !== undefined &&
      nowMs - lastConsolidatedMs < config.minHours * 60 * 60 * 1000
    ) {
      return { triggered: false, reason: 'min_hours' }
    }

    const sessions = (await listSessionMetas(input.workspaceRoot, env))
      .filter(meta => meta.sessionId !== state.currentSessionId)
      .filter(meta => {
        if (lastConsolidatedMs === undefined) {
          return true
        }
        const updatedMs = parseTimestamp(meta.updatedAt)
        return updatedMs !== undefined && updatedMs > lastConsolidatedMs
      })
    if (sessions.length < config.minSessions) {
      return { triggered: false, reason: 'min_sessions' }
    }

    const releaseLock = await acquireAutoDreamLock(input.workspaceRoot, env)
    if (!releaseLock) {
      return { triggered: false, reason: 'lock_held' }
    }

    try {
      const memoryDir = getMemoryDir(input.workspaceRoot, env)
      const entrypointPath = getMemoryEntrypointPath(input.workspaceRoot, env)
      const existingMemories = await loadMemoryManifest(input.workspaceRoot, env)
      const manifestLines = existingMemories.map(
        entry =>
          `- [${entry.type}] ${entry.relativePath} | ${entry.name}: ${entry.description}`,
      )
      const sessionSummaries = sessions.map(
        meta => `- ${meta.sessionId} updated ${meta.updatedAt} mode=${meta.mode}`,
      )
      const prompt = buildConsolidationPrompt({
        memoryDir,
        entrypointPath,
        touchedSessionCount: sessions.length,
        sessionSummaries,
        manifestLines,
      })
      const toolRegistry = createMemoryToolRegistry(memoryDir, [
        ...existingMemories,
      ])
      const toolContext: ToolContext = {
        cwd: memoryDir,
        availableTools: ['Read', 'Edit', 'Write', 'DeleteMemory'],
        permissionMode: 'bypass-permissions',
        readState: new Map(),
        sessionId: undefined,
      }

      state.queryTraceSink?.record({
        event: 'memory.autodream.start',
        data: {
          touchedSessionCount: sessions.length,
          memoryDir,
        },
      })
      const result = await executeSingleTurn({
        client: input.client,
        model: input.model,
        messages: [createTextMessage('user', prompt)],
        toolRegistry,
        toolContext,
        maxIterations: AUTO_DREAM_MAX_TURNS,
        queryTraceSink: state.queryTraceSink,
      })
      const changedMemoryPaths = extractChangedMemoryPaths(
        result.addedMessages,
        memoryDir,
      )
      await writeAutoDreamState(input.workspaceRoot, env, {
        lastConsolidatedAt: getNowIso(),
      })
      state.queryTraceSink?.record({
        event: 'memory.autodream.success',
        data: {
          touchedSessionCount: sessions.length,
          changedMemoryPaths,
          outputText: getTextContent(result.assistantMessage).slice(0, 500),
        },
      })
      await state.queryTraceSink?.flush().catch(() => undefined)

      if (changedMemoryPaths.length === 0) {
        return { triggered: false, reason: 'no_changes' }
      }

      return {
        triggered: true,
        touchedSessionCount: sessions.length,
        changedMemoryPaths,
        note: formatImprovedMemoryNote(changedMemoryPaths),
      }
    } finally {
      await releaseLock()
    }
  }

  return {
    runAutoDream,
    scheduleAutoDream(input: {
      state?: AutoDreamRunState
      onMessages?: (messages: Message[]) => Promise<void> | void
    } = {}): void {
      if (inProgress) {
        return
      }

      inProgress = runAutoDream(input.state)
        .then(async result => {
          if (result.triggered) {
            await input.onMessages?.([result.note])
            return [result.note]
          }
          return []
        })
        .finally(() => {
          inProgress = undefined
        })
    },
    async drainPendingAutoDream(
      timeoutMs: number = AUTO_DREAM_DRAIN_TIMEOUT_MS,
    ): Promise<void> {
      if (!inProgress) {
        return
      }

      await Promise.race([
        inProgress.catch(() => []),
        new Promise<void>(resolve => {
          setTimeout(resolve, timeoutMs).unref?.()
        }),
      ])
    },
  }
}
