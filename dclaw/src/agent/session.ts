import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { getSessionAgentMessagesPath, getSessionSubagentsDir } from '../session/paths.js'
import type { Message } from '../types/message.js'
import { loadAgent, updateAgent } from './store.js'
import type { AgentRecord } from './types.js'

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function ensureAgentMessagesFile(
  parentSessionId: string,
  agentId: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await ensureDirectory(getSessionSubagentsDir(parentSessionId, env))
  await appendFile(
    getSessionAgentMessagesPath(parentSessionId, agentId, env),
    '',
    'utf8',
  )
}

export async function loadAgentMessages(
  parentSessionId: string,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Message[]> {
  try {
    const text = await readFile(
      getSessionAgentMessagesPath(parentSessionId, agentId, env),
      'utf8',
    )
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as Message)
  } catch {
    return []
  }
}

export async function appendAgentMessages(
  parentSessionId: string,
  agentId: string,
  messages: Message[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (messages.length === 0) {
    return
  }

  await ensureAgentMessagesFile(parentSessionId, agentId, env)
  const serialized = messages.map(message => JSON.stringify(message)).join('\n')
  await appendFile(
    getSessionAgentMessagesPath(parentSessionId, agentId, env),
    serialized + '\n',
    'utf8',
  )
  await updateAgent(agentId, parentSessionId, agent => agent, env)
}

export type AgentSession = {
  agent: AgentRecord
  messages: Message[]
}

export async function loadAgentSession(
  parentSessionId: string,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentSession | null> {
  const agent = await loadAgent(agentId, parentSessionId, env)
  if (!agent) {
    return null
  }

  const messages = await loadAgentMessages(parentSessionId, agentId, env)
  return {
    agent,
    messages,
  }
}
