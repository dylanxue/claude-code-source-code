import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function resolveHomeDirectory(env: NodeJS.ProcessEnv): string {
  const home = trimOrUndefined(env.HOME)
  return home && home.length > 0 ? home : homedir()
}

export function getDclawHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredPath = trimOrUndefined(env.DCLAW_HOME)
  if (configuredPath) {
    return resolve(configuredPath)
  }

  return resolve(resolveHomeDirectory(env), '.dclaw')
}

export function getSessionsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'sessions')
}

export function getTaskBoardsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'task-boards')
}

export function getPlansDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'plans')
}

export function getDclawConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'config.json')
}

export function getQueryTracesDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'query-traces')
}

export function getBackgroundTasksDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'background-tasks')
}

export function getToolResultsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'tool-results')
}

export function getSessionDir(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionsDir(env), sessionId)
}

export function getSessionMetaPath(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, env), 'meta.json')
}

export function getSessionMessagesPath(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, env), 'messages.jsonl')
}

export function getSessionSubagentsDir(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, env), 'subagents')
}

export function getSessionAgentMetaPath(
  sessionId: string,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionSubagentsDir(sessionId, env), `agent-${agentId}.meta.json`)
}

export function getSessionAgentMessagesPath(
  sessionId: string,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionSubagentsDir(sessionId, env), `agent-${agentId}.jsonl`)
}

export function getSessionAgentLinksPath(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, env), 'agents.json')
}

export function getTaskBoardPath(
  boardId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getTaskBoardsDir(env), `${boardId}.json`)
}

export function getPlanFilePath(
  planFileId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getPlansDir(env), `${planFileId}.md`)
}
