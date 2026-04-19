import { join, resolve } from 'node:path'
import { getDclawHomeDir } from '../session/paths.js'

const PROJECTS_DIRNAME = 'projects'
const MEMORY_DIRNAME = 'memory'
const MEMORY_ENTRYPOINT_NAME = 'MEMORY.md'
const MAX_SANITIZED_LENGTH = 200

function simpleHash(value: string): string {
  let hash = 5381
  for (const char of value) {
    hash = (hash * 33) ^ char.charCodeAt(0)
  }
  return Math.abs(hash).toString(36)
}

export function sanitizeMemoryProjectKey(workspaceRoot: string): string {
  const normalized = resolve(workspaceRoot).normalize('NFC')
  const sanitized = normalized.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }

  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${simpleHash(normalized)}`
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
