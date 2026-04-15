import { StubLlmClient } from './providers/stub.js'
import type { LlmClient } from './types.js'

export type LlmProviderName = 'stub'

export function createLlmClient(provider: LlmProviderName = 'stub'): LlmClient {
  switch (provider) {
    case 'stub':
      return new StubLlmClient()
  }
}

