import { readdir } from 'node:fs/promises'
import {
  loadSessionSubagentSummary,
  type SessionSubagentSummary,
} from '../agent/observability.js'
import { formatToolUseLine } from '../cli/verboseEvents.js'
import {
  getCompactBoundaryMessages,
  getLastCompactBoundary,
} from '../compact/boundaryMessage.js'
import { formatCompactBoundaryLabel } from '../compact/types.js'
import { isPersistedToolResultOutput } from '../core/toolResultBudget.js'
import { getTextContent, type Message } from '../types/message.js'
import {
  describePlanModeToolUse,
  describeSystemReminderText,
  getTaskBoardObservationLines,
} from '../tasks/observability.js'
import { loadTaskBoard } from '../tasks/store.js'
import { getSessionsDir } from './paths.js'
import {
  loadSessionMessages,
  loadSessionMeta,
  type SessionPersistedToolResultRecord,
  type SessionMeta,
} from './store.js'

export type SessionHistoryEntry = {
  meta: SessionMeta
  messageCount: number
  lastUserText?: string
  lastAssistantText?: string
  lastBashSandboxMode?: string
  persistedToolResultCount: number
  lastPersistedToolResultPath?: string
  compactBoundaryCount: number
  lastCompactBoundaryLabel?: string
  planningSummary: string[]
  subagents: SessionSubagentSummary
}

function truncate(value: string, maxLength: number = 120): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}...`
}

function summarizeMessage(message: Message): string | undefined {
  const text = getTextContent(message).trim()
  const imageCount = message.content.filter(
    block => block.type === 'image',
  ).length
  const pdfCount = message.content.filter(
    block => block.type === 'pdf',
  ).length
  if (text.length > 0) {
    return truncate(
      (describeSystemReminderText(text) ?? text).replace(/\s+/g, ' '),
    )
  }
  if (imageCount > 0) {
    return imageCount === 1 ? '[image]' : `[${imageCount} images]`
  }
  if (pdfCount > 0) {
    return pdfCount === 1 ? '[pdf]' : `[${pdfCount} pdfs]`
  }

  for (const block of message.content) {
    if (block.type === 'tool_use') {
      const planModeSummary = describePlanModeToolUse(block.name, block.input)
      if (planModeSummary) {
        return planModeSummary
      }
      return formatToolUseLine({
        name: block.name,
        input: block.input,
      })
    }
    if (block.type === 'reasoning' && block.summary.length > 0) {
      return truncate(block.summary.join(' '))
    }
    if (block.type === 'thinking') {
      return 'Thinking in progress'
    }
    if (block.type === 'redacted_thinking') {
      return 'Thinking hidden'
    }
  }

  return undefined
}

function hasTextContent(message: Message): boolean {
  return message.content.some(
    block => block.type === 'text' && block.text.trim().length > 0,
  )
}

function isVisibleConversationMessage(message: Message): boolean {
  return message.transcriptOnly !== true
}

function extractSandboxModeFromToolResult(output: unknown): string | undefined {
  if (typeof output !== 'object' || output === null) {
    return undefined
  }

  const candidate = output as {
    output?: {
      sandboxMode?: unknown
    }
  }

  return typeof candidate.output?.sandboxMode === 'string'
    ? candidate.output.sandboxMode
    : undefined
}

function getLastBashSandboxMode(messages: Message[]): string | undefined {
  for (const message of [...messages].reverse()) {
    for (const block of message.content) {
      if (block.type !== 'tool_result') {
        continue
      }

      const sandboxMode = extractSandboxModeFromToolResult(
        block.rawOutput ?? block.output,
      )
      if (sandboxMode) {
        return sandboxMode
      }
    }
  }

  return undefined
}

function getPersistedToolResultInfo(messages: Message[]): {
  count: number
  lastPath?: string
} {
  let count = 0
  let lastPath: string | undefined

  for (const message of messages) {
    for (const block of message.content) {
      if (
        block.type === 'tool_result' &&
        isPersistedToolResultOutput(block.output)
      ) {
        count += 1
        lastPath = block.output.filepath
      }
    }
  }

  return { count, lastPath }
}

function getPersistedToolResultInfoFromMeta(
  records: SessionPersistedToolResultRecord[] | undefined,
): {
  count: number
  lastPath?: string
} | null {
  if (!records || records.length === 0) {
    return null
  }

  return {
    count: records.length,
    lastPath: records.at(-1)?.filepath,
  }
}

function compareUpdatedAtDesc(left: SessionMeta, right: SessionMeta): number {
  return right.updatedAt.localeCompare(left.updatedAt)
}

export async function listSessionMetas(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta[]> {
  try {
    const entries = await readdir(getSessionsDir(env), { withFileTypes: true })
    const metas = await Promise.all(
      entries
        .filter(entry => entry.isDirectory())
        .map(entry => loadSessionMeta(entry.name, env)),
    )

    return metas
      .filter((meta): meta is SessionMeta => Boolean(meta))
      .sort(compareUpdatedAtDesc)
  } catch {
    return []
  }
}

export async function listSessionHistory(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionHistoryEntry[]> {
  const metas = await listSessionMetas(env)

  return Promise.all(
    metas.map(async meta => {
      const messages = await loadSessionMessages(meta.sessionId, env)
      const compactBoundaries = getCompactBoundaryMessages(messages)
      const lastCompactBoundary = getLastCompactBoundary(messages)
      const persistedToolResultInfo =
        getPersistedToolResultInfoFromMeta(meta.persistedToolResults) ??
        getPersistedToolResultInfo(messages)
      const board =
        meta.taskBoardId ? await loadTaskBoard(meta.taskBoardId, env) : null
      const subagents = await loadSessionSubagentSummary(meta.sessionId, env)
      const lastUserMessage = [...messages]
        .reverse()
        .find(
          message =>
            message.role === 'user' &&
            isVisibleConversationMessage(message) &&
            hasTextContent(message),
        )
      const lastAssistantMessage = [...messages]
        .reverse()
        .find(
          message =>
            message.role === 'assistant' && isVisibleConversationMessage(message),
        )

      return {
        meta,
        messageCount: messages.length,
        lastUserText: lastUserMessage
          ? summarizeMessage(lastUserMessage)
          : undefined,
        lastAssistantText: lastAssistantMessage
          ? summarizeMessage(lastAssistantMessage)
          : undefined,
        lastBashSandboxMode: getLastBashSandboxMode(messages),
        persistedToolResultCount: persistedToolResultInfo.count,
        lastPersistedToolResultPath: persistedToolResultInfo.lastPath,
        compactBoundaryCount: compactBoundaries.length,
        lastCompactBoundaryLabel: lastCompactBoundary
          ? formatCompactBoundaryLabel(lastCompactBoundary)
          : undefined,
        planningSummary: board ? getTaskBoardObservationLines(board) : [],
        subagents,
      }
    }),
  )
}
