import { DEFAULT_QUERY_MAX_ITERATIONS } from '../core/queryLoop.js'
import type { RuntimeConfigSource } from '../llm/providerUtils.js'
import { trimOrUndefined } from '../llm/providerUtils.js'
import { loadDclawConfigFiles } from './configFile.js'

export const DEFAULT_CLI_MAX_ITERATIONS = DEFAULT_QUERY_MAX_ITERATIONS

export type MaxIterationsSource = 'cli' | RuntimeConfigSource

export type ResolvedMaxIterations = {
  maxIterations: number
  maxIterationsSource: MaxIterationsSource
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = trimOrUndefined(value)
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return undefined
  }

  const parsed = Number.parseInt(trimmed, 10)
  return parsed > 0 ? parsed : undefined
}

function resolveEnvMaxIterations(
  env: NodeJS.ProcessEnv,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): ResolvedMaxIterations | undefined {
  const parsed = parsePositiveInteger(env.DCLAW_MAX_ITERATIONS)
  if (parsed === undefined) {
    return undefined
  }

  return {
    maxIterations: parsed,
    maxIterationsSource: getEnvSource?.('DCLAW_MAX_ITERATIONS') ?? 'env',
  }
}

function resolveConfiguredMaxIterations(
  config: Record<string, unknown> | undefined,
  path: string,
  source: Extract<RuntimeConfigSource, 'user_config' | 'workspace_config'>,
): ResolvedMaxIterations | undefined {
  if (!config || config.maxIterations === undefined) {
    return undefined
  }

  const parsed = parsePositiveInteger(config.maxIterations)
  if (parsed === undefined) {
    throw new Error(
      `Invalid dclaw config at ${path}: maxIterations must be a positive integer`,
    )
  }

  return {
    maxIterations: parsed,
    maxIterationsSource: source,
  }
}

export async function resolveMaxIterations(
  options: {
    cwd: string
    maxIterations?: number
  },
  env: NodeJS.ProcessEnv = process.env,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): Promise<ResolvedMaxIterations> {
  if (options.maxIterations !== undefined) {
    return {
      maxIterations: options.maxIterations,
      maxIterationsSource: 'cli',
    }
  }

  const envMaxIterations = resolveEnvMaxIterations(env, getEnvSource)
  if (envMaxIterations) {
    return envMaxIterations
  }

  const {
    userConfig,
    workspaceConfig,
    userConfigPath,
    workspaceConfigPath,
  } = await loadDclawConfigFiles(options.cwd, env)
  const userMaxIterations = resolveConfiguredMaxIterations(
    userConfig,
    userConfigPath,
    'user_config',
  )
  if (userMaxIterations) {
    return userMaxIterations
  }

  const workspaceMaxIterations = resolveConfiguredMaxIterations(
    workspaceConfig,
    workspaceConfigPath,
    'workspace_config',
  )
  if (workspaceMaxIterations) {
    return workspaceMaxIterations
  }

  return {
    maxIterations: DEFAULT_CLI_MAX_ITERATIONS,
    maxIterationsSource: 'default',
  }
}
