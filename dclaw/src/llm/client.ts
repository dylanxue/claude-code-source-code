import { AnthropicLlmClient } from './providers/anthropic.js'
import { OpenAiLlmClient } from './providers/openai.js'
import { StubLlmClient } from './providers/stub.js'
import type { LlmClient } from './types.js'

export type LlmProviderName = 'stub' | 'anthropic' | 'openai'

export const SUPPORTED_LLM_PROVIDERS = ['stub', 'anthropic', 'openai'] as const

export function createLlmClient(provider: LlmProviderName = 'stub'): LlmClient {
  switch (provider) {
    case 'stub':
      return new StubLlmClient()
    case 'anthropic':
      return new AnthropicLlmClient()
    case 'openai':
      return new OpenAiLlmClient()
  }
}
