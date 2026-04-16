import type { Message } from '../types/message.js'
import {
  loadSessionMessages,
  loadSessionMeta,
  type SessionMeta,
} from './store.js'

export type ResumedSession = {
  meta: SessionMeta
  messages: Message[]
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
  return {
    meta,
    messages,
  }
}
