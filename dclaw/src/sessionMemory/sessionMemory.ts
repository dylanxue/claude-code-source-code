import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getMessagesAfterCompactBoundary } from '../compact/boundaryMessage.js'
import { canAdvanceSessionMemoryCheckpoint } from '../compact/sessionMemoryCompact.js'
import { executeSingleTurn } from '../core/queryLoop.js'
import type { QueryTraceSink } from '../core/queryTrace.js'
import type { LlmClient } from '../llm/types.js'
import { getSessionMemoryPath } from '../session/paths.js'
import { updateSessionMeta } from '../session/store.js'
import {
  createTextMessage,
  getModelVisibleMessages,
  type Message,
} from '../types/message.js'
import type { ToolContext } from '../types/tool.js'
import { editTool } from '../tools/builtin/edit.js'
import { readFileTool } from '../tools/builtin/readFile.js'
import { ToolRegistry } from '../tools/registry.js'
import { buildTool, type Tool } from '../tools/types.js'
import {
  buildSessionMemoryUpdatePrompt,
  getSessionMemoryUpdateSystemPrompt,
  SESSION_MEMORY_TEMPLATE,
} from './prompts.js'

export const SESSION_MEMORY_UPDATE_MESSAGE_THRESHOLD = 6
export const SESSION_MEMORY_UPDATE_DRAIN_TIMEOUT_MS = 1_500

function isTemplateOrEmpty(content: string): boolean {
  const normalized = content.trim()
  return (
    normalized.length === 0 ||
    normalized === SESSION_MEMORY_TEMPLATE.trim()
  )
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function ensureSessionMemoryFile(path: string): Promise<{
  created: boolean
  content: string
}> {
  const existing = await readTextFile(path)
  if (existing !== null) {
    return { created: false, content: existing }
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, SESSION_MEMORY_TEMPLATE, 'utf8')
  return { created: true, content: SESSION_MEMORY_TEMPLATE }
}

export async function loadSessionMemory(input: {
  sessionId: string
  env?: NodeJS.ProcessEnv
}): Promise<{
  path: string
  content: string
} | null> {
  const env = input.env ?? process.env
  const path = getSessionMemoryPath(input.sessionId, env)
  const content = await readTextFile(path)
  if (content === null || isTemplateOrEmpty(content)) {
    return null
  }

  return { path, content }
}

function countMessagesSince(
  messages: Message[],
  lastMessageId: string | undefined,
): number {
  if (!lastMessageId) {
    return messages.length
  }

  const index = messages.findIndex(message => message.id === lastMessageId)
  return index === -1 ? messages.length : messages.length - index - 1
}

function restrictToolToSessionMemoryFile<T extends Tool>(
  tool: T,
  notesPath: string,
): T {
  return buildTool({
    ...tool,
    validate(input: unknown, context: ToolContext) {
      const filePath =
        typeof input === 'object' && input !== null
          ? (input as { file_path?: unknown; path?: unknown }).file_path ??
            (input as { path?: unknown }).path
          : undefined
      if (filePath !== notesPath) {
        return {
          ok: false,
          error: `Session memory update may only access ${notesPath}`,
        }
      }

      return tool.validate(input as never, context)
    },
  }) as T
}

function createSessionMemoryToolRegistry(notesPath: string): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(restrictToolToSessionMemoryFile(readFileTool, notesPath))
  registry.register(restrictToolToSessionMemoryFile(editTool, notesPath))
  return registry
}

export function createSessionMemoryUpdater(input: {
  client: LlmClient
  model?: string
  env?: NodeJS.ProcessEnv
}) {
  let lastProcessedMessageId: string | undefined
  let inProgress = false
  let pending:
    | {
        sessionId: string
        messages: Message[]
        queryTraceSink?: QueryTraceSink
      }
    | undefined
  const inFlightUpdates = new Set<Promise<void>>()

  async function updateSessionMemory(state: {
    sessionId: string
    messages: Message[]
    queryTraceSink?: QueryTraceSink
  }): Promise<void> {
    const env = input.env ?? process.env
    const modelVisibleMessages = getMessagesAfterCompactBoundary(
      getModelVisibleMessages(state.messages),
    )
    const newMessageCount = countMessagesSince(
      modelVisibleMessages,
      lastProcessedMessageId,
    )
    if (
      modelVisibleMessages.length === 0 ||
      newMessageCount < SESSION_MEMORY_UPDATE_MESSAGE_THRESHOLD
    ) {
      return
    }

    const latestMessage = modelVisibleMessages.at(-1)
    if (!latestMessage) {
      return
    }

    const notesPath = getSessionMemoryPath(state.sessionId, env)
    await ensureSessionMemoryFile(notesPath)
    state.queryTraceSink?.record({
      event: 'session_memory.update.start',
      data: {
        sessionId: state.sessionId,
        notesPath,
        newMessageCount,
      },
    })

    try {
      const toolContext: ToolContext = {
        cwd: dirname(notesPath),
        availableTools: ['Read', 'Edit'],
        permissionMode: 'bypass-permissions',
        readState: new Map(),
      }
      await executeSingleTurn({
        client: input.client,
        model: input.model,
        systemPrompt: getSessionMemoryUpdateSystemPrompt(notesPath),
        messages: [
          createTextMessage(
            'user',
            buildSessionMemoryUpdatePrompt({
              notesPath,
              messages: modelVisibleMessages,
            }),
          ),
        ],
        toolRegistry: createSessionMemoryToolRegistry(notesPath),
        toolContext,
        maxIterations: 4,
        queryTraceSink: state.queryTraceSink,
      })
      lastProcessedMessageId = latestMessage.id
      const now = new Date().toISOString()
      await updateSessionMeta(
        state.sessionId,
        meta => ({
          ...meta,
          sessionMemory: {
            ...(meta.sessionMemory ?? {}),
            path: notesPath,
            updatedAt: now,
            ...(canAdvanceSessionMemoryCheckpoint(modelVisibleMessages)
              ? {
                  coveredMessageId: latestMessage.id,
                  coveredAt: now,
                }
              : {}),
          },
          updatedAt: now,
        }),
        env,
      )
      state.queryTraceSink?.record({
        event: 'session_memory.update.success',
        data: {
          sessionId: state.sessionId,
          notesPath,
          coveredMessageId: canAdvanceSessionMemoryCheckpoint(modelVisibleMessages)
            ? latestMessage.id
            : undefined,
        },
      })
    } catch (error) {
      state.queryTraceSink?.record({
        event: 'session_memory.update.failure',
        data: {
          sessionId: state.sessionId,
          notesPath,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) },
        },
      })
    } finally {
      await state.queryTraceSink?.flush().catch(() => undefined)
    }
  }

  async function executeScheduledUpdate(
    initial: NonNullable<typeof pending>,
  ): Promise<void> {
    if (inProgress) {
      pending = initial
      return
    }

    inProgress = true
    let current: typeof initial | undefined = initial
    try {
      while (current) {
        pending = undefined
        await updateSessionMemory(current)
        current = pending
      }
    } finally {
      inProgress = false
      pending = undefined
    }
  }

  return {
    getSessionMemoryPath(sessionId: string): string {
      return getSessionMemoryPath(sessionId, input.env ?? process.env)
    },
    async ensureSessionMemoryFile(sessionId: string): Promise<string> {
      const path = getSessionMemoryPath(sessionId, input.env ?? process.env)
      await ensureSessionMemoryFile(path)
      return path
    },
    scheduleUpdate(state: {
      sessionId: string
      messages: Message[]
      queryTraceSink?: QueryTraceSink
    }): void {
      const task = executeScheduledUpdate(state)
      inFlightUpdates.add(task)
      void task.finally(() => {
        inFlightUpdates.delete(task)
      })
    },
    async drainPendingUpdate(
      timeoutMs: number = SESSION_MEMORY_UPDATE_DRAIN_TIMEOUT_MS,
    ): Promise<void> {
      if (inFlightUpdates.size === 0) {
        return
      }

      await Promise.race([
        Promise.all(inFlightUpdates).catch(() => undefined),
        new Promise<void>(resolve => {
          setTimeout(resolve, timeoutMs).unref?.()
        }),
      ])
    },
  }
}
