import { normalizeBaseUrl } from './providerUtils.js'
import type {
  OpenAiApiStyle,
  ProviderProfileConfig,
} from './config.js'
import type {
  OpenAiReasoningEffort,
  OpenAiTextVerbosity,
} from './types.js'

export type StubProviderConfig = {
  provider: 'stub'
}

export type AnthropicProviderConfig = {
  provider: 'anthropic'
  apiKey?: string
  baseUrl: string
  proxyUrl?: string
}

export type OpenAiProviderConfig = {
  provider: 'openai'
  apiKey?: string
  baseUrl: string
  proxyUrl?: string
  apiStyle: OpenAiApiStyle
  defaultTextVerbosity?: OpenAiTextVerbosity
  defaultReasoningEffort?: OpenAiReasoningEffort
  defaultStore?: boolean
}

export type ResolvedProviderConfig =
  | StubProviderConfig
  | AnthropicProviderConfig
  | OpenAiProviderConfig

export function resolveProviderConfig(
  profile: ProviderProfileConfig,
): ResolvedProviderConfig {
  switch (profile.type) {
    case 'stub':
      return {
        provider: 'stub',
      }
    case 'anthropic':
      return {
        provider: 'anthropic',
        apiKey: profile.apiKey,
        baseUrl: normalizeBaseUrl(
          profile.baseURL,
          'https://api.anthropic.com',
        ),
        ...(profile.proxyURL ? { proxyUrl: profile.proxyURL } : {}),
      }
    case 'openai':
      return {
        provider: 'openai',
        apiKey: profile.apiKey,
        baseUrl: normalizeBaseUrl(
          profile.baseURL,
          'https://api.openai.com/v1',
        ),
        ...(profile.proxyURL ? { proxyUrl: profile.proxyURL } : {}),
        apiStyle: profile.apiStyle ?? 'responses',
        defaultTextVerbosity: profile.requestDefaults?.verbosity,
        defaultReasoningEffort: profile.requestDefaults?.reasoningEffort,
        defaultStore: profile.requestDefaults?.store,
      }
  }
}
