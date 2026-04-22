import type { Message } from '../types/message.js'
import {
  loadSessionSubagentSummary,
  type SessionSubagentSummary,
} from '../agent/observability.js'
import {
  loadSessionMessages,
  loadSessionMeta,
  type SessionMeta,
} from './store.js'

export type ResumedSession = {
  meta: SessionMeta
  messages: Message[]
  subagents: SessionSubagentSummary
}

export async function loadSessionForResume(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResumedSession | null> {
  const meta = await loadSessionMeta(sessionId, env)
  if (!meta) {
    return null
  }

  const messages = await loadSessionMessages(sessionId, env)
  const subagents = await loadSessionSubagentSummary(sessionId, env)
  return {
    meta,
    messages,
    subagents,
  }
}
