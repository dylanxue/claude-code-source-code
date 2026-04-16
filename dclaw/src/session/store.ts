import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import type { Message } from '../types/message.js'
import {
  getSessionDir,
  getSessionMessagesPath,
  getSessionMetaPath,
  getSessionsDir,
} from './paths.js'

export type SessionMode = 'interactive' | 'print'

export type SessionMeta = {
  sessionId: string
  cwd: string
  mode: SessionMode
  provider: string
  model?: string
  createdAt: string
  updatedAt: string
}

export type CreateSessionInput = {
  cwd: string
  mode: SessionMode
  provider: string
  model?: string
  sessionId?: string
  env?: NodeJS.ProcessEnv
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, 'utf8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function writeSessionMeta(
  meta: SessionMeta,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await ensureDirectory(getSessionDir(meta.sessionId, env))
  await writeFile(
    getSessionMetaPath(meta.sessionId, env),
    JSON.stringify(meta, null, 2) + '\n',
    'utf8',
  )
}

async function ensureSessionMessagesFile(
  sessionId: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await ensureDirectory(getSessionDir(sessionId, env))
  await appendFile(getSessionMessagesPath(sessionId, env), '', 'utf8')
}

export async function createSession(
  input: CreateSessionInput,
): Promise<SessionMeta> {
  const env = input.env ?? process.env
  const sessionId = input.sessionId ?? randomUUID()
  const existing = await loadSessionMeta(sessionId, env)
  if (existing) {
    await ensureSessionMessagesFile(sessionId, env)
    return existing
  }

  await ensureDirectory(getSessionsDir(env))
  const now = new Date().toISOString()
  const meta: SessionMeta = {
    sessionId,
    cwd: input.cwd,
    mode: input.mode,
    provider: input.provider,
    model: input.model,
    createdAt: now,
    updatedAt: now,
  }

  await writeSessionMeta(meta, env)
  await ensureSessionMessagesFile(sessionId, env)
  return meta
}

export async function loadSessionMeta(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta | null> {
  return readJsonFile<SessionMeta>(getSessionMetaPath(sessionId, env))
}

export async function loadSessionMessages(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Message[]> {
  try {
    const text = await readFile(getSessionMessagesPath(sessionId, env), 'utf8')
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as Message)
  } catch {
    return []
  }
}

export async function appendSessionMessages(
  sessionId: string,
  messages: Message[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (messages.length === 0) {
    return
  }

  await ensureSessionMessagesFile(sessionId, env)
  const serialized = messages.map(message => JSON.stringify(message)).join('\n')
  await appendFile(getSessionMessagesPath(sessionId, env), serialized + '\n', 'utf8')

  const meta = await loadSessionMeta(sessionId, env)
  if (!meta) {
    return
  }

  await writeSessionMeta(
    {
      ...meta,
      updatedAt: new Date().toISOString(),
    },
    env,
  )
}

export async function countSessions(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const path = getSessionsDir(env)
    await ensureDirectory(path)
    const entries = await readdir(path, { withFileTypes: true })
    return entries.length
  } catch {
    return 0
  }
}
