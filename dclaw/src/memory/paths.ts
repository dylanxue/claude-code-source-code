import { join } from 'node:path'
import { sanitizeProjectKey } from '../projectKey.js'
import { getDclawHomeDir } from '../session/paths.js'

const PROJECTS_DIRNAME = 'projects'
const MEMORY_DIRNAME = 'memory'
const MEMORY_ENTRYPOINT_NAME = 'MEMORY.md'

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
