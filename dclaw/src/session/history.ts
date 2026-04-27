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
  isSystemReminderText,
} from '../tasks/observability.js'
import { loadTaskBoard } from '../tasks/store.js'
import { getSessionsDir } from './paths.js'
import {
  loadSessionMessages,
  loadSessionMeta,
  type SessionPersistedToolResultRecord,
  type SessionMeta,
} from './store.js'

const MAX_TITLE_LENGTH = 80
const MAX_TITLE_SOURCE_MESSAGES = 8

export type SessionHistoryEntry = {
  meta: SessionMeta
  messageCount: number
  conversationTitle: string
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

function normalizeTitleText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/gu, '')
    .trim()
}

function isLowInformationContinuation(value: string): boolean {
  const normalized = normalizeTitleText(value).toLowerCase()
  return /^(继续|继续吧|接着|接着来|下一步|好的|好|嗯|可以|是的|继续|continue|go on|next|ok|yes)$/iu.test(
    normalized,
  )
}

function summarizeUserMessageForTitle(message: Message): string | undefined {
  const text = normalizeTitleText(getTextContent(message))
  if (text.length > 0 && isSystemReminderText(text)) {
    return undefined
  }

  if (text.length === 0) {
    return summarizeMessage(message)
  }

  return truncate(text, MAX_TITLE_LENGTH)
}

function getConversationTitle(messages: Message[]): string {
  const recentUserTitles = [...messages]
    .reverse()
    .filter(
      message =>
        message.role === 'user' &&
        isVisibleConversationMessage(message) &&
        hasUserTitleContent(message),
    )
    .slice(0, MAX_TITLE_SOURCE_MESSAGES)
    .map(summarizeUserMessageForTitle)
    .filter((title): title is string => Boolean(title))

  const informativeTitle = recentUserTitles.find(
    title => !isLowInformationContinuation(title),
  )
  if (informativeTitle) {
    return informativeTitle
  }

  const fallbackTitle = recentUserTitles[0]
  if (fallbackTitle) {
    return fallbackTitle
  }

  const lastAssistantMessage = [...messages]
    .reverse()
    .find(
      message =>
        message.role === 'assistant' && isVisibleConversationMessage(message),
    )
  const assistantTitle = lastAssistantMessage
    ? summarizeMessage(lastAssistantMessage)
    : undefined

  return assistantTitle ?? '<empty session>'
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

function hasUserTitleContent(message: Message): boolean {
  const text = getTextContent(message).trim()
  if (text.length === 0) {
    return false
  }

  return !isSystemReminderText(text)
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

  const sessions: Array<SessionHistoryEntry | null> = await Promise.all(
    metas.map(async (meta): Promise<SessionHistoryEntry | null> => {
      const messages = await loadSessionMessages(meta.sessionId, env)
      if (messages.length === 0) {
        return null
      }

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
            hasUserTitleContent(message),
        )
      const lastAssistantMessage = [...messages]
        .reverse()
        .find(
          message =>
            message.role === 'assistant' && isVisibleConversationMessage(message),
        )
      const lastUserText = lastUserMessage
        ? summarizeMessage(lastUserMessage)
        : undefined
      const lastAssistantText = lastAssistantMessage
        ? summarizeMessage(lastAssistantMessage)
        : undefined
      const lastBashSandboxMode = getLastBashSandboxMode(messages)
      const lastCompactBoundaryLabel = lastCompactBoundary
        ? formatCompactBoundaryLabel(lastCompactBoundary)
        : undefined

      return {
        meta,
        messageCount: messages.length,
        conversationTitle: getConversationTitle(messages),
        ...(lastUserText ? { lastUserText } : {}),
        ...(lastAssistantText ? { lastAssistantText } : {}),
        ...(lastBashSandboxMode ? { lastBashSandboxMode } : {}),
        persistedToolResultCount: persistedToolResultInfo.count,
        ...(persistedToolResultInfo.lastPath
          ? { lastPersistedToolResultPath: persistedToolResultInfo.lastPath }
          : {}),
        compactBoundaryCount: compactBoundaries.length,
        ...(lastCompactBoundaryLabel ? { lastCompactBoundaryLabel } : {}),
        planningSummary: board ? getTaskBoardObservationLines(board) : [],
        subagents,
      }
    }),
  )

  return sessions.filter(
    (session): session is SessionHistoryEntry => Boolean(session),
  )
}
