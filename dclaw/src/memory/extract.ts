import { basename, relative, resolve, sep } from 'node:path'
import { executeSingleTurn } from '../core/queryLoop.js'
import type { QueryTraceSink } from '../core/queryTrace.js'
import type { LlmClient } from '../llm/types.js'
import { getMessagesAfterCompactBoundary } from '../compact/boundaryMessage.js'
import {
  createTextMessage,
  createTranscriptOnlyTextMessage,
  getModelVisibleMessages,
  getToolUseBlocks,
  type Message,
} from '../types/message.js'
import type { ToolContext, ToolValidationResult } from '../types/tool.js'
import { editTool, type EditToolInput } from '../tools/builtin/edit.js'
import { readFileTool, type ReadFileToolInput } from '../tools/builtin/readFile.js'
import { writeTool, type WriteToolInput } from '../tools/builtin/write.js'
import { ToolRegistry } from '../tools/registry.js'
import { buildTool, type Tool } from '../tools/types.js'
import { findMemoryUpgradeCandidate } from './dedupe.js'
import { parseMemoryDocument } from './frontmatter.js'
import {
  ensureMemoryScaffold,
} from './store.js'
import { buildMemoryExtractionPrompt } from './extractPrompt.js'
import { getMemoryDir, getMemoryEntrypointPath } from './paths.js'
import {
  loadMemoryManifest,
  type MemoryManifestEntry,
} from './manifest.js'

const MEMORY_EXTRACTION_MAX_TURNS = 5
const MEMORY_EXTRACTION_DRAIN_TIMEOUT_MS = 60_000

function isWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const normalizedTarget = resolve(targetPath)
  const normalizedDirectory = resolve(directoryPath)
  const rel = relative(normalizedDirectory, normalizedTarget)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`))
}

function getInputPath(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }

  if ('file_path' in input && typeof input.file_path === 'string') {
    return input.file_path
  }

  if ('path' in input && typeof input.path === 'string') {
    return input.path
  }

  return undefined
}

function validateMemoryScopedPath(
  input: unknown,
  memoryDir: string,
): ToolValidationResult {
  const candidatePath = getInputPath(input)
  if (!candidatePath) {
    return {
      ok: false,
      error: 'Memory extraction tool call is missing a target path.',
    }
  }

  if (!isWithinDirectory(candidatePath, memoryDir)) {
    return {
      ok: false,
      error: `Memory extraction may only access files inside ${memoryDir}`,
    }
  }

  return { ok: true }
}

function wrapMemoryScopedTool<I, O>(
  tool: Tool<I, O>,
  memoryDir: string,
): Tool<I, O> {
  return buildTool({
    name: tool.name,
    description: tool.description,
    prompt(context) {
      return tool.prompt(context)
    },
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    maxResultSizeChars: tool.maxResultSizeChars,
    mapToolResult(result) {
      return tool.mapToolResult(result)
    },
    isEnabled(context) {
      return tool.isEnabled(context)
    },
    isReadOnly(input) {
      return tool.isReadOnly(input)
    },
    async validate(input, context) {
      const scoped = validateMemoryScopedPath(input, memoryDir)
      if (!scoped.ok) {
        return scoped
      }
      return tool.validate(input, context)
    },
    async call(input, context) {
      const scoped = validateMemoryScopedPath(input, memoryDir)
      if (!scoped.ok) {
        throw new Error(scoped.error)
      }
      return tool.call(input, context)
    },
  })
}

function isMemoryEntrypointPath(filePath: string): boolean {
  return basename(filePath) === 'MEMORY.md'
}

function updateKnownMemoryEntries(
  knownEntries: MemoryManifestEntry[],
  memoryDir: string,
  filePath: string,
  content: string,
): void {
  if (isMemoryEntrypointPath(filePath)) {
    return
  }

  const parsed = parseMemoryDocument(content)
  if (!parsed.frontmatter) {
    return
  }

  const normalizedPath = resolve(filePath)
  const entry: MemoryManifestEntry = {
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description,
    type: parsed.frontmatter.type,
    updatedAt: parsed.frontmatter.updated_at,
    path: normalizedPath,
    relativePath: relative(memoryDir, normalizedPath),
    mtimeMs: Date.now(),
  }
  const existingIndex = knownEntries.findIndex(
    candidate => candidate.path === normalizedPath,
  )
  if (existingIndex === -1) {
    knownEntries.push(entry)
    return
  }
  knownEntries.splice(existingIndex, 1, entry)
}

function validateMemoryDuplicateWrite(
  filePath: string,
  content: string,
  knownEntries: MemoryManifestEntry[],
): ToolValidationResult {
  if (isMemoryEntrypointPath(filePath)) {
    return { ok: true }
  }

  const parsed = parseMemoryDocument(content)
  if (!parsed.frontmatter) {
    return { ok: true }
  }

  const targetPath = resolve(filePath)
  const candidate = findMemoryUpgradeCandidate(
    parsed.frontmatter,
    knownEntries,
    targetPath,
  )
  if (!candidate) {
    return { ok: true }
  }

  const reason =
    candidate.reason === 'same_name'
      ? 'same type and name'
      : 'a uniquely similar description'
  return {
    ok: false,
    error:
      `This memory matches an existing file by ${reason}. ` +
      `Update ${candidate.entry.path} instead of creating a duplicate.`,
  }
}

function wrapMemoryWriteTool(
  memoryDir: string,
  knownEntries: MemoryManifestEntry[],
): Tool<WriteToolInput, any> {
  return buildTool({
    name: writeTool.name,
    description: writeTool.description,
    prompt(context) {
      return writeTool.prompt(context)
    },
    inputSchema: writeTool.inputSchema,
    outputSchema: writeTool.outputSchema,
    maxResultSizeChars: writeTool.maxResultSizeChars,
    mapToolResult(result) {
      return writeTool.mapToolResult(result)
    },
    isEnabled(context) {
      return writeTool.isEnabled(context)
    },
    isReadOnly(input) {
      return writeTool.isReadOnly(input)
    },
    async validate(input, context) {
      const scoped = validateMemoryScopedPath(input, memoryDir)
      if (!scoped.ok) {
        return scoped
      }
      const dedupe = validateMemoryDuplicateWrite(
        input.file_path,
        input.content,
        knownEntries,
      )
      if (!dedupe.ok) {
        return dedupe
      }
      return writeTool.validate(input, context)
    },
    async call(input, context) {
      const scoped = validateMemoryScopedPath(input, memoryDir)
      if (!scoped.ok) {
        throw new Error(scoped.error)
      }
      const result = await writeTool.call(input, context)
      updateKnownMemoryEntries(
        knownEntries,
        memoryDir,
        input.file_path,
        input.content,
      )
      return result
    },
  })
}

function wrapMemoryEditTool(
  memoryDir: string,
  knownEntries: MemoryManifestEntry[],
): Tool<EditToolInput, any> {
  return buildTool({
    name: editTool.name,
    description: editTool.description,
    prompt(context) {
      return editTool.prompt(context)
    },
    inputSchema: editTool.inputSchema,
    outputSchema: editTool.outputSchema,
    maxResultSizeChars: editTool.maxResultSizeChars,
    mapToolResult(result) {
      return editTool.mapToolResult(result)
    },
    isEnabled(context) {
      return editTool.isEnabled(context)
    },
    isReadOnly(input) {
      return editTool.isReadOnly(input)
    },
    async validate(input, context) {
      const scoped = validateMemoryScopedPath(input, memoryDir)
      if (!scoped.ok) {
        return scoped
      }
      if (input.old_string === '') {
        const dedupe = validateMemoryDuplicateWrite(
          input.file_path,
          input.new_string,
          knownEntries,
        )
        if (!dedupe.ok) {
          return dedupe
        }
      }
      return editTool.validate(input, context)
    },
    async call(input, context) {
      const scoped = validateMemoryScopedPath(input, memoryDir)
      if (!scoped.ok) {
        throw new Error(scoped.error)
      }
      const result = await editTool.call(input, context)
      if (result.output && typeof result.output.content === 'string') {
        updateKnownMemoryEntries(
          knownEntries,
          memoryDir,
          input.file_path,
          result.output.content,
        )
      }
      return result
    },
  })
}

function createMemoryToolRegistry(
  memoryDir: string,
  knownEntries: MemoryManifestEntry[],
): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(
    wrapMemoryScopedTool<ReadFileToolInput, any>(
      readFileTool,
      memoryDir,
    ),
  )
  registry.register(
    wrapMemoryEditTool(memoryDir, knownEntries),
  )
  registry.register(
    wrapMemoryWriteTool(memoryDir, knownEntries),
  )
  return registry
}

function extractWrittenMemoryPaths(
  messages: Message[],
  memoryDir: string,
): string[] {
  const pendingToolPaths = new Map<string, string>()
  const seen = new Set<string>()
  const paths: string[] = []

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const block of getToolUseBlocks(message)) {
        if (block.name !== 'Edit' && block.name !== 'Write') {
          continue
        }
        const filePath = getInputPath(block.input)
        if (!filePath || !isWithinDirectory(filePath, memoryDir)) {
          continue
        }
        pendingToolPaths.set(block.id, resolve(filePath))
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
      if (seen.has(filePath)) {
        continue
      }
      seen.add(filePath)
      paths.push(filePath)
    }
  }

  return paths
}

function countMessagesSince(
  messages: Message[],
  sinceId: string | undefined,
): number {
  if (!sinceId) {
    return messages.length
  }

  const index = messages.findIndex(message => message.id === sinceId)
  if (index === -1) {
    return messages.length
  }

  return messages.length - index - 1
}

function formatMemorySavedSummary(paths: string[]): Message {
  const lines = [
    `Saved ${paths.length} memory ${paths.length === 1 ? 'file' : 'files'}:`,
    ...paths.map(path => `- ${path}`),
  ]
  return createTranscriptOnlyTextMessage('system', lines.join('\n'))
}

export function createAutomaticMemoryExtractor(input: {
  client: LlmClient
  model?: string
  workspaceRoot: string
  env?: NodeJS.ProcessEnv
}) {
  let lastProcessedMessageId: string | undefined
  let inProgress = false
  type ExtractTurnState = {
    userPrompt: string
    messages: Message[]
    systemPrompt?: string
    queryTraceSink?: QueryTraceSink
  }
  type ScheduledExtraction = {
    state: Omit<ExtractTurnState, 'systemPrompt'> & {
      systemPrompt?: string
      resolveSystemPrompt?: () => Promise<string | undefined>
    }
    onMessages?: (messages: Message[]) => Promise<void> | void
  }
  let pending:
    | ScheduledExtraction
    | undefined
  const inFlightExtractions = new Set<Promise<void>>()

  async function extractTurn(state: ExtractTurnState): Promise<Message[]> {
    const env = input.env ?? process.env
    const modelVisibleMessages = getMessagesAfterCompactBoundary(
      getModelVisibleMessages(state.messages),
    )
    const newMessageCount = countMessagesSince(
      modelVisibleMessages,
      lastProcessedMessageId,
    )
    if (modelVisibleMessages.length === 0 || newMessageCount <= 0) {
      return []
    }

    const latestMessage = modelVisibleMessages.at(-1)
    if (!latestMessage) {
      return []
    }

    const memoryDir = getMemoryDir(input.workspaceRoot, env)
    const entrypointPath = getMemoryEntrypointPath(input.workspaceRoot, env)
    state.queryTraceSink?.record({
      event: 'memory.extract.start',
      data: {
        memoryDir,
        newMessageCount,
      },
    })

    try {
      await ensureMemoryScaffold(input.workspaceRoot, env)
      const existingMemories = await loadMemoryManifest(input.workspaceRoot, env)
      const extractionPrompt = buildMemoryExtractionPrompt({
        newMessageCount,
        memoryDir,
        existingMemories,
      })
      const toolRegistry = createMemoryToolRegistry(
        memoryDir,
        [...existingMemories],
      )
      const toolContext: ToolContext = {
        cwd: memoryDir,
        availableTools: ['Read', 'Edit', 'Write'],
        permissionMode: 'bypass-permissions',
        readState: new Map(),
        sessionId: undefined,
      }
      const result = await executeSingleTurn({
        client: input.client,
        model: input.model,
        systemPrompt: state.systemPrompt,
        messages: [...modelVisibleMessages, createTextMessage('user', extractionPrompt)],
        toolRegistry,
        toolContext,
        maxIterations: MEMORY_EXTRACTION_MAX_TURNS,
        queryTraceSink: state.queryTraceSink,
      })

      lastProcessedMessageId = latestMessage.id
      const writtenPaths = extractWrittenMemoryPaths(result.addedMessages, memoryDir)
      const savedMemoryPaths = writtenPaths.filter(
        path => basename(path) !== basename(entrypointPath),
      )

      state.queryTraceSink?.record({
        event: 'memory.extract.success',
        data: {
          memoryDir,
          writtenPaths,
          savedMemoryPaths,
        },
      })

      if (savedMemoryPaths.length === 0) {
        await state.queryTraceSink?.flush().catch(() => undefined)
        return []
      }

      await state.queryTraceSink?.flush().catch(() => undefined)
      return [formatMemorySavedSummary(savedMemoryPaths)]
    } catch (error) {
      state.queryTraceSink?.record({
        event: 'memory.extract.failure',
        data: {
          memoryDir,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) },
        },
      })
      await state.queryTraceSink?.flush().catch(() => undefined)
      return []
    }
  }

  async function runScheduledExtraction(
    state: ScheduledExtraction['state'],
    onMessages?: (messages: Message[]) => Promise<void> | void,
  ): Promise<void> {
    const produced = await extractTurn({
      userPrompt: state.userPrompt,
      messages: state.messages,
      queryTraceSink: state.queryTraceSink,
      systemPrompt:
        state.systemPrompt ??
        (state.resolveSystemPrompt
          ? await state.resolveSystemPrompt()
          : undefined),
    })
    if (produced.length === 0) {
      return
    }
    await onMessages?.(produced)
  }

  async function executeScheduledExtractions(
    initial: ScheduledExtraction,
  ): Promise<void> {
    if (inProgress) {
      pending = initial
      initial.state.queryTraceSink?.record({
        event: 'memory.extract.coalesced',
        data: {
          pendingMessageCount: initial.state.messages.length,
        },
      })
      return
    }

    inProgress = true
    let current: typeof initial | undefined = initial
    try {
      while (current) {
        pending = undefined
        await runScheduledExtraction(current.state, current.onMessages)
        current = pending
      }
    } finally {
      inProgress = false
      pending = undefined
    }
  }

  return {
    extractTurn,
    scheduleExtractTurn(input: {
      state: ScheduledExtraction['state']
      onMessages?: (messages: Message[]) => Promise<void> | void
    }): void {
      const task = executeScheduledExtractions(input)
      inFlightExtractions.add(task)
      void task.finally(() => {
        inFlightExtractions.delete(task)
      })
    },
    async drainPendingExtraction(
      timeoutMs: number = MEMORY_EXTRACTION_DRAIN_TIMEOUT_MS,
    ): Promise<void> {
      if (inFlightExtractions.size === 0) {
        return
      }

      await Promise.race([
        Promise.all(inFlightExtractions).catch(() => undefined),
        new Promise<void>(resolve => {
          setTimeout(resolve, timeoutMs).unref?.()
        }),
      ])
    },
  }
}
