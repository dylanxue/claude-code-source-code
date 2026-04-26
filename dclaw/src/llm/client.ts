import { AnthropicLlmClient } from './providers/anthropic.js'
import { OpenAiLlmClient } from './providers/openai.js'
import { StubLlmClient } from './providers/stub.js'
import type { ModelCatalogOverrides } from './config.js'
import type { ResolvedProviderConfig } from './providerConfig.js'
import type { LlmClient } from './types.js'
export { SUPPORTED_LLM_PROVIDERS } from './providerNames.js'

export function createLlmClient(
  providerConfig: ResolvedProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  modelCatalogOverrides?: ModelCatalogOverrides,
): LlmClient {
  switch (providerConfig.provider) {
    case 'stub':
      return new StubLlmClient()
    case 'anthropic':
      return new AnthropicLlmClient({
        env,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        modelCatalogOverrides,
      })
    case 'openai':
      return new OpenAiLlmClient({
        env,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        apiStyle: providerConfig.apiStyle,
        defaultTextVerbosity: providerConfig.defaultTextVerbosity,
        defaultReasoningEffort: providerConfig.defaultReasoningEffort,
        defaultStore: providerConfig.defaultStore,
        modelCatalogOverrides,
      })
  }
}
