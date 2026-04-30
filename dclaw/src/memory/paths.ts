import { join } from 'node:path'
import { sanitizeProjectKey } from '../projectKey.js'
import { getDclawHomeDir } from '../session/paths.js'

const PROJECTS_DIRNAME = 'projects'
const MEMORY_DIRNAME = 'memory'
const MEMORY_ENTRYPOINT_NAME = 'MEMORY.md'
const MEMORY_CONSOLIDATION_STATE_NAME = 'auto-dream.json'
const MEMORY_CONSOLIDATION_LOCK_NAME = 'auto-dream.lock'

export function sanitizeMemoryProjectKey(workspaceRoot: string): string {
  return sanitizeProjectKey(workspaceRoot)
}

export function getMemoryProjectsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDclawHomeDir(env), PROJECTS_DIRNAME)
}

export function getMemoryDir(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    getMemoryProjectsDir(env),
    sanitizeMemoryProjectKey(workspaceRoot),
    MEMORY_DIRNAME,
  )
}

export function getMemoryEntrypointPath(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMemoryDir(workspaceRoot, env), MEMORY_ENTRYPOINT_NAME)
}

export function getMemoryFilePath(
  workspaceRoot: string,
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMemoryDir(workspaceRoot, env), relativePath)
}

export function getMemoryConsolidationStatePath(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMemoryDir(workspaceRoot, env), MEMORY_CONSOLIDATION_STATE_NAME)
}

export function getMemoryConsolidationLockPath(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMemoryDir(workspaceRoot, env), MEMORY_CONSOLIDATION_LOCK_NAME)
}
