import { normalizeBaseUrl, trimOrUndefined } from './providerUtils.js'
import type { LlmProviderName } from './providerNames.js'

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export type OpenAiApiStyle = 'responses' | 'chat-completions'

export type StubProviderConfig = {
  provider: 'stub'
  defaultModel?: undefined
}

export type AnthropicProviderConfig = {
  provider: 'anthropic'
  apiKey?: string
  baseUrl: string
  defaultModel?: string
}

export type OpenAiProviderConfig = {
  provider: 'openai'
  apiKey?: string
  baseUrl: string
  defaultModel?: string
  apiStyle: OpenAiApiStyle
}

export type ResolvedProviderConfig =
  | StubProviderConfig
  | AnthropicProviderConfig
  | OpenAiProviderConfig

function inferOpenAiApiStyle(
  baseUrl: string,
  env: NodeJS.ProcessEnv,
): OpenAiApiStyle {
  const explicit =
    trimOrUndefined(env.DCLAW_OPENAI_API_STYLE) ??
    trimOrUndefined(env.OPENAI_API_STYLE)

  if (explicit === 'responses' || explicit === 'chat-completions') {
    return explicit
  }

  if (trimOrUndefined(env.MODEL_PROVIDER) === 'openai-compatible') {
    return 'chat-completions'
  }

  try {
    const url = new URL(baseUrl)
    return url.hostname === 'api.openai.com' ? 'responses' : 'chat-completions'
  } catch {
    return 'chat-completions'
  }
}

export function resolveAnthropicProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnthropicProviderConfig {
  return {
    provider: 'anthropic',
    apiKey:
      trimOrUndefined(env.DCLAW_ANTHROPIC_API_KEY) ??
      trimOrUndefined(env.ANTHROPIC_API_KEY),
    baseUrl: normalizeBaseUrl(
      env.DCLAW_ANTHROPIC_BASE_URL ?? env.ANTHROPIC_BASE_URL,
      DEFAULT_ANTHROPIC_BASE_URL,
    ),
    defaultModel:
      trimOrUndefined(env.DCLAW_ANTHROPIC_MODEL) ??
      trimOrUndefined(env.ANTHROPIC_MODEL),
  }
}

export function resolveOpenAiProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiProviderConfig {
  const baseUrl = normalizeBaseUrl(
    env.DCLAW_OPENAI_BASE_URL ?? env.OPENAI_BASE_URL,
    DEFAULT_OPENAI_BASE_URL,
  )

  return {
    provider: 'openai',
    apiKey:
      trimOrUndefined(env.DCLAW_OPENAI_API_KEY) ??
      trimOrUndefined(env.OPENAI_API_KEY),
    baseUrl,
    defaultModel:
      trimOrUndefined(env.DCLAW_OPENAI_MODEL) ??
      trimOrUndefined(env.OPENAI_MODEL),
    apiStyle: inferOpenAiApiStyle(baseUrl, env),
  }
}

export function resolveProviderConfig(
  provider: LlmProviderName,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProviderConfig {
  switch (provider) {
    case 'anthropic':
      return resolveAnthropicProviderConfig(env)
    case 'openai':
      return resolveOpenAiProviderConfig(env)
    case 'stub':
      return {
        provider: 'stub',
      }
  }
}
