import { randomUUID } from 'node:crypto'
import type { ContextStats } from '../core/contextStats.js'
import type { QueryTraceSink } from '../core/queryTrace.js'
import type { LlmClient } from '../llm/types.js'
import { formatTranscript } from '../session/transcript.js'
import {
  appendSessionMessages,
  loadSessionMeta,
  updateSessionMeta,
  type SessionMeta,
} from '../session/store.js'
import type { Message } from '../types/message.js'
import { createCompactSummaryMessage } from './compactSummary.js'
import { createCompactBoundaryMessage } from './boundaryMessage.js'
import { summarizeCompactSession } from './summarize.js'
import type { CompactBoundary, CompactTrigger } from './types.js'
import { loadSessionMemory } from '../sessionMemory/sessionMemory.js'
import { calculateSessionMemoryMessagesToKeep } from './sessionMemoryCompact.js'

export type CompactSessionInput = {
  sourceSessionId: string
  messages: Message[]
  cwd: string
  provider: string
  model?: string
  trigger: CompactTrigger
  reason?: string
  instructionText?: string
  transcriptMessageLimit?: number
  contextStats?: ContextStats
  client?: LlmClient
  queryTraceSink?: QueryTraceSink
  env?: NodeJS.ProcessEnv
}

export type CompactSessionResult = {
  session: SessionMeta
  boundary: CompactBoundary
  boundaryMessage: Message
  summaryMessage: Message
  messagesToKeep: Message[]
  sessionMemoryCompact?: {
    checkpointMessageId: string
    startIndex: number
    coveredMessageIndex: number
    keptMessageCount: number
  }
}

export async function compactSession(
  input: CompactSessionInput,
): Promise<CompactSessionResult> {
  const env = input.env ?? process.env
  const sourceMeta = await loadSessionMeta(input.sourceSessionId, env)
  const createdAt = new Date().toISOString()
  const sessionMemory = await loadSessionMemory({
    sessionId: input.sourceSessionId,
    env,
  })
  const checkpointMessageId = sourceMeta?.sessionMemory?.coveredMessageId
  const sessionMemoryTail =
    sessionMemory && checkpointMessageId
      ? calculateSessionMemoryMessagesToKeep(
          input.messages,
          checkpointMessageId,
        )
      : undefined
  const shouldUseSessionMemoryTail =
    sessionMemoryTail !== undefined && !sessionMemoryTail.fallbackReason
  const sessionMemoryForPrompt =
    sessionMemoryTail?.fallbackReason ? null : sessionMemory
  const messagesForCompact = shouldUseSessionMemoryTail
    ? sessionMemoryTail.messagesToKeep
    : input.messages
  const messagesToKeep = shouldUseSessionMemoryTail
    ? sessionMemoryTail.messagesToKeep
    : []
  input.queryTraceSink?.record({
    event: 'session_memory.compact',
    data: {
      sessionId: input.sourceSessionId,
      hasSessionMemory: sessionMemory !== null,
      checkpointMessageId,
      usedSessionMemoryTail: shouldUseSessionMemoryTail,
      fallbackReason: sessionMemoryTail?.fallbackReason,
      messagesToKeepCount: messagesToKeep.length,
      startIndex: sessionMemoryTail?.startIndex,
      coveredMessageIndex: sessionMemoryTail?.coveredMessageIndex,
    },
  })
  const transcriptLines = formatTranscript(messagesForCompact, {
    includeThinking: false,
    maxMessages: input.transcriptMessageLimit ?? 40,
  })
  if (!input.client) {
    throw new Error('compactSession requires an explicit llm client')
  }
  const compactSummary = await summarizeCompactSession({
    client: input.client,
    model: input.model,
    transcriptLines,
    instructionText: input.instructionText,
    contextStats: input.contextStats,
    sessionMemory: sessionMemoryForPrompt ?? undefined,
  })
  const boundaryBase = {
    boundaryId: `compact_${randomUUID()}`,
    createdAt,
    trigger: input.trigger,
    ...(input.reason ? { reason: input.reason } : {}),
    messageCountBefore: input.messages.length,
  }
  const { boundary, summaryMessage } = createCompactSummaryMessage({
    boundary: boundaryBase,
    summaryText: compactSummary,
  })
  const boundaryMessage = createCompactBoundaryMessage(boundary)
  const compactMessages = [boundaryMessage, summaryMessage, ...messagesToKeep]
  await appendSessionMessages(
    input.sourceSessionId,
    compactMessages,
    env,
  )
  await updateSessionMeta(
    input.sourceSessionId,
    meta => ({
      ...meta,
      sessionMemory: meta.sessionMemory
        ? {
            ...meta.sessionMemory,
            coveredMessageId: undefined,
            coveredAt: undefined,
            updatedAt: createdAt,
          }
        : undefined,
      updatedAt: createdAt,
    }),
    env,
  )

  return {
    session: (await loadSessionMeta(input.sourceSessionId, env)) ?? {
      sessionId: input.sourceSessionId,
      cwd: input.cwd,
      mode: 'interactive',
      provider: input.provider,
      model: input.model,
      planMode: sourceMeta?.planMode,
      createdAt,
      updatedAt: createdAt,
      persistedToolResults: [],
    },
    boundary,
    boundaryMessage,
    summaryMessage,
    messagesToKeep,
    ...(shouldUseSessionMemoryTail && checkpointMessageId
      ? {
          sessionMemoryCompact: {
            checkpointMessageId,
            startIndex: sessionMemoryTail.startIndex,
            coveredMessageIndex: sessionMemoryTail.coveredMessageIndex,
            keptMessageCount: messagesToKeep.length,
          },
        }
      : {}),
  }
}
