import { trimOrUndefined } from './providerUtils.js'
import type { LlmProviderName } from './providerNames.js'

export type LlmProviderSelectionSource = 'cli' | 'env' | 'default'

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

  const envProvider =
    normalizeProviderName(env.DCLAW_PROVIDER) ??
    normalizeProviderName(env.LLM_PROVIDER) ??
    normalizeProviderName(env.MODEL_PROVIDER)

  if (envProvider) {
    return {
      provider: envProvider,
      source: 'env',
    }
  }

  return {
    provider: 'stub',
    source: 'default',
  }
}
