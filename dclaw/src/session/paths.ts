import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { sanitizeProjectKey } from '../projectKey.js'

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

function resolveWorkspaceRoot(env: NodeJS.ProcessEnv): string {
  return resolve(
    trimOrUndefined(env.DCLAW_WORKSPACE_ROOT) ??
      trimOrUndefined(env.PWD) ??
      process.cwd(),
  )
}

export function getProjectSessionsDir(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    getProjectsDir(env),
    sanitizeProjectKey(workspaceRoot),
    'sessions',
  )
}

export function getProjectsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'projects')
}

export function getProjectDir(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getProjectsDir(env), sanitizeProjectKey(workspaceRoot))
}

export function getProjectPlanBoardsDir(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getProjectDir(workspaceRoot, env), 'task-boards')
}

export function getProjectExecutionTaskBoardsDir(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getProjectDir(workspaceRoot, env), 'execution-task-boards')
}

export function getProjectQueryTracesDir(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getProjectDir(workspaceRoot, env), 'query-traces')
}

export function getProjectPlansDir(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getProjectDir(workspaceRoot, env), 'plans')
}

function getProjectSessionDir(
  workspaceRoot: string,
  sessionId: string,
  env: NodeJS.ProcessEnv,
): string {
  return join(getProjectSessionsDir(workspaceRoot, env), sessionId)
}

export function getDclawConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), 'config.json')
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
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof workspaceRootOrEnv === 'string') {
    return getProjectSessionDir(workspaceRootOrEnv, sessionId, maybeEnv)
  }

  const env = workspaceRootOrEnv
  return getProjectSessionDir(resolveWorkspaceRoot(env), sessionId, env)
}

export function getSessionMetaPath(
  sessionId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, workspaceRootOrEnv, maybeEnv), 'meta.json')
}

export function getSessionMessagesPath(
  sessionId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    getSessionDir(sessionId, workspaceRootOrEnv, maybeEnv),
    'messages.jsonl',
  )
}

export function getSessionMemoryPath(
  sessionId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    getSessionDir(sessionId, workspaceRootOrEnv, maybeEnv),
    'session-memory.md',
  )
}

export function getSessionSubagentsDir(
  sessionId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, workspaceRootOrEnv, maybeEnv), 'subagents')
}

export function getSessionAgentMetaPath(
  sessionId: string,
  agentId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    getSessionSubagentsDir(sessionId, workspaceRootOrEnv, maybeEnv),
    `agent-${agentId}.meta.json`,
  )
}

export function getSessionAgentMessagesPath(
  sessionId: string,
  agentId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    getSessionSubagentsDir(sessionId, workspaceRootOrEnv, maybeEnv),
    `agent-${agentId}.jsonl`,
  )
}

export function getSessionAgentLinksPath(
  sessionId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, workspaceRootOrEnv, maybeEnv), 'agents.json')
}

export function getPlanBoardPath(
  boardId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof workspaceRootOrEnv === 'string') {
    return join(getProjectPlanBoardsDir(workspaceRootOrEnv, maybeEnv), `${boardId}.json`)
  }

  const env = workspaceRootOrEnv
  return join(getProjectPlanBoardsDir(resolveWorkspaceRoot(env), env), `${boardId}.json`)
}

export function getExecutionTaskBoardPath(
  boardId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof workspaceRootOrEnv === 'string') {
    return join(
      getProjectExecutionTaskBoardsDir(workspaceRootOrEnv, maybeEnv),
      `${boardId}.json`,
    )
  }

  const env = workspaceRootOrEnv
  return join(
    getProjectExecutionTaskBoardsDir(resolveWorkspaceRoot(env), env),
    `${boardId}.json`,
  )
}

export function getPlanFilePath(
  planFileId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  maybeEnv: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof workspaceRootOrEnv === 'string') {
    return join(getProjectPlansDir(workspaceRootOrEnv, maybeEnv), `${planFileId}.md`)
  }

  const env = workspaceRootOrEnv
  return join(getProjectPlansDir(resolveWorkspaceRoot(env), env), `${planFileId}.md`)
}
