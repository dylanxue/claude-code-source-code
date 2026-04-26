import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getDclawConfigPath } from '../session/paths.js'

export type DclawConfigFile = Record<string, unknown> & {
  permissionMode?: unknown
  maxIterations?: unknown
  llm?: unknown
}

export type ConfigEnvSource = 'user_config' | 'workspace_config'

export function getWorkspaceConfigPath(cwd: string): string {
  return join(resolve(cwd), '.dclaw', 'config.json')
}

export async function readConfigFile(
  path: string,
): Promise<DclawConfigFile | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown JSON parse error'
    throw new Error(`Invalid dclaw config at ${path}: ${message}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid dclaw config at ${path}: expected a JSON object`)
  }

  return parsed as DclawConfigFile
}

export async function loadDclawConfigFiles(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  userConfig?: DclawConfigFile
  workspaceConfig?: DclawConfigFile
  userConfigPath: string
  workspaceConfigPath: string
}> {
  const userConfigPath = getDclawConfigPath(env)
  const workspaceConfigPath = getWorkspaceConfigPath(cwd)

  const [userConfig, workspaceConfig] = await Promise.all([
    readConfigFile(userConfigPath),
    readConfigFile(workspaceConfigPath),
  ])

  return {
    userConfig,
    workspaceConfig,
    userConfigPath,
    workspaceConfigPath,
  }
}

export type ConfigAwareEnv = {
  env: NodeJS.ProcessEnv
  keySources: Partial<Record<string, ConfigEnvSource>>
}

function hasConfiguredEnvValue(
  env: NodeJS.ProcessEnv,
  key: string,
): boolean {
  const value = env[key]
  if (value === undefined) {
    return false
  }

  return value.trim().length > 0
}

function isEnvLikeConfigKey(key: string): boolean {
  return (
    key.startsWith('DCLAW_') &&
    /^[A-Z_][A-Z0-9_]*$/.test(key) &&
    key !== 'DCLAW_HOME' &&
    key !== 'DCLAW_PROVIDER' &&
    key !== 'DCLAW_VISION_PROVIDER' &&
    key !== 'DCLAW_VISION_MODEL' &&
    !key.startsWith('DCLAW_OPENAI_') &&
    !key.startsWith('DCLAW_ANTHROPIC_')
  )
}

function stringifyConfigEnvValue(key: string, value: unknown, path: string): string {
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'boolean':
      return String(value)
    case 'object':
      if (value === null) {
        throw new Error(`Invalid dclaw config at ${path}: ${key} cannot be null`)
      }
      return JSON.stringify(value)
    default:
      throw new Error(
        `Invalid dclaw config at ${path}: ${key} must be a string, number, boolean, or JSON value`,
      )
  }
}

function applyConfigEnvEntries(
  targetEnv: NodeJS.ProcessEnv,
  keySources: Partial<Record<string, ConfigEnvSource>>,
  originalKeys: Set<string>,
  config: DclawConfigFile | undefined,
  path: string,
  source: 'user' | 'workspace',
): void {
  if (!config) {
    return
  }

  for (const [key, value] of Object.entries(config)) {
    if (!isEnvLikeConfigKey(key)) {
      continue
    }

    if (originalKeys.has(key) && hasConfiguredEnvValue(targetEnv, key)) {
      continue
    }

    targetEnv[key] = stringifyConfigEnvValue(key, value, path)
    keySources[key] = source === 'user' ? 'user_config' : 'workspace_config'
  }
}

export async function buildConfigAwareEnvWithSources(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfigAwareEnv> {
  const {
    userConfig,
    workspaceConfig,
    userConfigPath,
    workspaceConfigPath,
  } = await loadDclawConfigFiles(cwd, env)
  const configuredEnv = { ...env }
  const keySources: Partial<Record<string, ConfigEnvSource>> = {}
  const originalKeys = new Set(Object.keys(env))

  applyConfigEnvEntries(
    configuredEnv,
    keySources,
    originalKeys,
    workspaceConfig,
    workspaceConfigPath,
    'workspace',
  )
  applyConfigEnvEntries(
    configuredEnv,
    keySources,
    originalKeys,
    userConfig,
    userConfigPath,
    'user',
  )

  return {
    env: configuredEnv,
    keySources,
  }
}

export async function buildConfigAwareEnv(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const configured = await buildConfigAwareEnvWithSources(cwd, env)
  return configured.env
}
