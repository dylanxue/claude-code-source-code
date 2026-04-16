import { AnthropicLlmClient } from './providers/anthropic.js'
import { OpenAiLlmClient } from './providers/openai.js'
import { StubLlmClient } from './providers/stub.js'
import type { LlmClient } from './types.js'
import type { LlmProviderName } from './providerNames.js'
import { resolveLlmProvider } from './providerSelection.js'
export { SUPPORTED_LLM_PROVIDERS } from './providerNames.js'

export function createLlmClient(
  provider?: LlmProviderName,
  env: NodeJS.ProcessEnv = process.env,
): LlmClient {
  switch (resolveLlmProvider(provider, env).provider) {
    case 'stub':
      return new StubLlmClient()
    case 'anthropic':
      return new AnthropicLlmClient()
    case 'openai':
      return new OpenAiLlmClient()
  }
}
