import { resolveModelLimits, type ModelLimits } from './modelLimits.js'
import { resolveModelSelection, type ModelSelectionSource } from './modelSelection.js'
import {
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from './providerConfig.js'
import { resolveLlmProvider, type LlmProviderSelectionSource } from './providerSelection.js'
import type { LlmProviderName } from './providerNames.js'
import type { ConfigEnvSource } from '../cli/configFile.js'

export type ResolvedLlmRuntimeConfig = {
  provider: LlmProviderName
  providerSource: LlmProviderSelectionSource
  providerConfig: ResolvedProviderConfig
  model?: string
  modelSource: ModelSelectionSource
  modelLimits?: ModelLimits
}

export function resolveLlmRuntimeConfig(
  options: {
    provider?: LlmProviderName
    model?: string
  },
  env: NodeJS.ProcessEnv = process.env,
  getEnvSource?: (key: string) => ConfigEnvSource | undefined,
): ResolvedLlmRuntimeConfig {
  const providerSelection = resolveLlmProvider(options.provider, env, getEnvSource)
  const providerConfig = resolveProviderConfig(
    providerSelection.provider,
    env,
    getEnvSource,
  )
  const modelSelection = resolveModelSelection(
    options.model,
    providerConfig.defaultModel,
    providerConfig.defaultModelSource ?? 'env',
  )

  return {
    provider: providerSelection.provider,
    providerSource: providerSelection.source,
    providerConfig,
    model: modelSelection.model,
    modelSource: modelSelection.source,
    modelLimits:
      providerSelection.provider === 'stub'
        ? undefined
        : resolveModelLimits(
            providerSelection.provider,
            modelSelection.model,
            env,
          ),
  }
}
