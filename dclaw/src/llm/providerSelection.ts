import { trimOrUndefined } from './providerUtils.js'
import type { LlmProviderName } from './providerNames.js'

export type LlmProviderSelectionSource =
  | 'cli'
  | 'env'
  | 'user_config'
  | 'workspace_config'
  | 'default'

function normalizeProviderName(
  value: string | undefined,
): LlmProviderName | undefined {
  const normalized = trimOrUndefined(value)?.toLowerCase()
  switch (normalized) {
    case 'stub':
      return 'stub'
    case 'anthropic':
    case 'anthropic-compatible':
      return 'anthropic'
    case 'openai':
    case 'openai-compatible':
      return 'openai'
    default:
      return undefined
  }
}

export function resolveLlmProvider(
  providerOverride: LlmProviderName | undefined,
  env: NodeJS.ProcessEnv = process.env,
  getEnvSource?: (
    key: string,
  ) => Exclude<LlmProviderSelectionSource, 'cli' | 'default' | 'env'> | undefined,
): {
  provider: LlmProviderName
  source: LlmProviderSelectionSource
} {
  if (providerOverride) {
    return {
      provider: providerOverride,
      source: 'cli',
    }
  }

  const providerKeys = ['DCLAW_PROVIDER', 'LLM_PROVIDER', 'MODEL_PROVIDER'] as const

  for (const key of providerKeys) {
    const envProvider = normalizeProviderName(env[key])
    if (!envProvider) {
      continue
    }

    return {
      provider: envProvider,
      source: getEnvSource?.(key) ?? 'env',
    }
  }

  return {
    provider: 'stub',
    source: 'default',
  }
}
