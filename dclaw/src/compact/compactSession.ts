import { randomUUID } from 'node:crypto'
import type { ContextStats } from '../core/contextStats.js'
import type { LlmClient } from '../llm/types.js'
import { formatTranscript } from '../session/transcript.js'
import {
  appendSessionMessages,
  loadSessionMeta,
  type SessionMeta,
} from '../session/store.js'
import type { Message } from '../types/message.js'
import { createCompactSummaryMessage } from './compactSummary.js'
import { createCompactBoundaryMessage } from './boundaryMessage.js'
import { summarizeCompactSession } from './summarize.js'
import type { CompactBoundary, CompactTrigger } from './types.js'

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
  env?: NodeJS.ProcessEnv
}

export type CompactSessionResult = {
  session: SessionMeta
  boundary: CompactBoundary
  boundaryMessage: Message
  summaryMessage: Message
}

export async function compactSession(
  input: CompactSessionInput,
): Promise<CompactSessionResult> {
  const env = input.env ?? process.env
  const sourceMeta = await loadSessionMeta(input.sourceSessionId, env)
  const createdAt = new Date().toISOString()
  const transcriptLines = formatTranscript(input.messages, {
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
  await appendSessionMessages(
    input.sourceSessionId,
    [boundaryMessage, summaryMessage],
    env,
  )

  return {
    session: (await loadSessionMeta(input.sourceSessionId, env)) ?? {
      sessionId: input.sourceSessionId,
      cwd: input.cwd,
      mode: 'interactive',
      provider: input.provider,
      model: input.model,
      taskBoardId: sourceMeta?.taskBoardId,
      createdAt,
      updatedAt: createdAt,
      persistedToolResults: [],
    },
    boundary,
    boundaryMessage,
    summaryMessage,
  }
}
