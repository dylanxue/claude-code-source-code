import { resolveModelSelection, type ModelSelectionSource } from './modelSelection.js'
import {
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from './providerConfig.js'
import { resolveLlmProvider, type LlmProviderSelectionSource } from './providerSelection.js'
import type { LlmProviderName } from './providerNames.js'

export type ResolvedLlmRuntimeConfig = {
  provider: LlmProviderName
  providerSource: LlmProviderSelectionSource
  providerConfig: ResolvedProviderConfig
  model?: string
  modelSource: ModelSelectionSource
}

export function resolveLlmRuntimeConfig(
  options: {
    provider?: LlmProviderName
    model?: string
  },
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlmRuntimeConfig {
  const providerSelection = resolveLlmProvider(options.provider, env)
  const providerConfig = resolveProviderConfig(providerSelection.provider, env)
  const modelSelection = resolveModelSelection(
    options.model,
    providerConfig.defaultModel,
  )

  return {
    provider: providerSelection.provider,
    providerSource: providerSelection.source,
    providerConfig,
    model: modelSelection.model,
    modelSource: modelSelection.source,
  }
}
