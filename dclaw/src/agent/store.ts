import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import {
  getSessionAgentLinksPath,
  getSessionAgentMetaPath,
  getSessionDir,
  getSessionSubagentsDir,
} from '../session/paths.js'
import type {
  AgentRecord,
  AgentStatus,
  CreateAgentInput,
  ListAgentsInput,
  SessionAgentLink,
} from './types.js'
import {
  DEFAULT_SUBAGENT_MAX_ITERATIONS,
  DEFAULT_SUBAGENT_MAX_TURNS,
} from './types.js'

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback
  }

  return value
}

function nowIso(): string {
  return new Date().toISOString()
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

function normalizeAgentRecord(agent: AgentRecord): AgentRecord {
  const completedAt =
    agent.status === 'completed' ||
    agent.status === 'failed' ||
    agent.status === 'stopped'
      ? trimOrUndefined(agent.completedAt) ?? agent.updatedAt
      : undefined

  return {
    agentId: agent.agentId,
    parentAgentId: trimOrUndefined(agent.parentAgentId),
    parentSessionId: trimOrUndefined(agent.parentSessionId),
    parentTurnId: trimOrUndefined(agent.parentTurnId),
    status: isAgentStatus(agent.status) ? agent.status : 'queued',
    task: trimOrUndefined(agent.task) ?? 'Untitled agent task',
    cwd: agent.cwd,
    provider: agent.provider,
    model: trimOrUndefined(agent.model),
    permissionMode: agent.permissionMode,
    availableTools: Array.isArray(agent.availableTools)
      ? agent.availableTools.filter(
          (toolName, index, values): toolName is string =>
            typeof toolName === 'string' &&
            toolName.trim().length > 0 &&
            values.indexOf(toolName) === index,
        )
      : [],
    maxTurns: normalizePositiveInteger(
      agent.maxTurns,
      DEFAULT_SUBAGENT_MAX_TURNS,
    ),
    maxIterations: normalizePositiveInteger(
      agent.maxIterations,
      DEFAULT_SUBAGENT_MAX_ITERATIONS,
    ),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    completedAt,
    lastError: trimOrUndefined(agent.lastError),
  }
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'stopped'
  )
}

function normalizeSessionAgentLink(link: SessionAgentLink): SessionAgentLink {
  return {
    parentTurnId: link.parentTurnId,
    agentId: link.agentId,
    status: isAgentStatus(link.status) ? link.status : 'queued',
    task: trimOrUndefined(link.task) ?? 'Untitled agent task',
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  }
}

async function writeAgentMeta(
  agent: AgentRecord,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parentSessionId = agent.parentSessionId
  if (!parentSessionId) {
    throw new Error(`Agent ${agent.agentId} is missing parentSessionId`)
  }

  await ensureDirectory(getSessionSubagentsDir(parentSessionId, env))
  await writeFile(
    getSessionAgentMetaPath(parentSessionId, agent.agentId, env),
    JSON.stringify(agent, null, 2) + '\n',
    'utf8',
  )
}

async function writeSessionAgentLinks(
  sessionId: string,
  links: SessionAgentLink[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await ensureDirectory(getSessionDir(sessionId, env))
  await writeFile(
    getSessionAgentLinksPath(sessionId, env),
    JSON.stringify(links, null, 2) + '\n',
    'utf8',
  )
}

async function upsertSessionAgentLink(
  sessionId: string,
  link: SessionAgentLink,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const existing = await loadSessionAgentLinks(sessionId, env)
  const next = [...existing]
  const index = next.findIndex(candidate => candidate.agentId === link.agentId)

  if (index >= 0) {
    next[index] = normalizeSessionAgentLink(link)
  } else {
    next.push(normalizeSessionAgentLink(link))
  }

  next.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  await writeSessionAgentLinks(sessionId, next, env)
}

async function syncAgentLink(agent: AgentRecord, env: NodeJS.ProcessEnv): Promise<void> {
  if (!agent.parentSessionId || !agent.parentTurnId) {
    return
  }

  await upsertSessionAgentLink(
    agent.parentSessionId,
    {
      parentTurnId: agent.parentTurnId,
      agentId: agent.agentId,
      status: agent.status,
      task: agent.task,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    },
    env,
  )
}

export async function loadSessionAgentLinks(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionAgentLink[]> {
  const links = await readJsonFile<SessionAgentLink[]>(
    getSessionAgentLinksPath(sessionId, env),
  )
  return Array.isArray(links) ? links.map(normalizeSessionAgentLink) : []
}

export async function createAgent(
  input: CreateAgentInput,
): Promise<AgentRecord> {
  const env = input.env ?? process.env
  const agentId = input.agentId ?? `agent_${randomUUID()}`
  const existing = await loadAgent(agentId, input.parentSessionId, env)
  if (existing) {
    return existing
  }

  const now = nowIso()
  const agent = normalizeAgentRecord({
    agentId,
    parentAgentId: input.parentAgentId,
    parentSessionId: input.parentSessionId,
    parentTurnId: input.parentTurnId,
    status: input.status ?? 'queued',
    task: input.task,
    cwd: input.cwd,
    provider: input.provider,
    model: input.model,
    permissionMode: input.permissionMode,
    availableTools: input.availableTools,
    maxTurns: input.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS,
    maxIterations: input.maxIterations ?? DEFAULT_SUBAGENT_MAX_ITERATIONS,
    createdAt: now,
    updatedAt: now,
  })

  await writeAgentMeta(agent, env)
  await syncAgentLink(agent, env)
  return agent
}

export async function loadAgent(
  agentId: string,
  parentSessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentRecord | null> {
  const agent = await readJsonFile<AgentRecord>(
    getSessionAgentMetaPath(parentSessionId, agentId, env),
  )
  return agent ? normalizeAgentRecord(agent) : null
}

export async function updateAgent(
  agentId: string,
  parentSessionId: string,
  updater: (agent: AgentRecord) => AgentRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentRecord | null> {
  const current = await loadAgent(agentId, parentSessionId, env)
  if (!current) {
    return null
  }

  const updatedAt = nowIso()
  const next = normalizeAgentRecord({
    ...updater(current),
    agentId: current.agentId,
    createdAt: current.createdAt,
    updatedAt,
  })

  await writeAgentMeta(next, env)
  await syncAgentLink(next, env)
  return next
}

export async function listAgents(
  input: ListAgentsInput,
): Promise<AgentRecord[]> {
  const env = input.env ?? process.env

  try {
    const entries = await readdir(getSessionSubagentsDir(input.parentSessionId, env), {
      withFileTypes: true,
    })
    const agents = await Promise.all(
      entries
        .filter(
          entry =>
            entry.isFile() &&
            entry.name.startsWith('agent-') &&
            entry.name.endsWith('.meta.json'),
        )
        .map(entry =>
          loadAgent(
            entry.name.slice('agent-'.length, -'.meta.json'.length),
            input.parentSessionId,
            env,
          ),
        ),
    )

    return agents
      .filter((agent): agent is AgentRecord => Boolean(agent))
      .filter(agent =>
        input.parentAgentId
          ? agent.parentAgentId === input.parentAgentId
          : true,
      )
      .filter(agent =>
        input.parentSessionId
          ? agent.parentSessionId === input.parentSessionId
          : true,
      )
      .filter(agent => (input.status ? agent.status === input.status : true))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } catch {
    return []
  }
}
