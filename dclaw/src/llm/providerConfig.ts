import { normalizeBaseUrl, trimOrUndefined } from './providerUtils.js'
import type { LlmProviderName } from './providerNames.js'
import type {
  OpenAiReasoningEffort,
  OpenAiTextVerbosity,
} from './types.js'
import type { ModelSelectionSource } from './modelSelection.js'

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export type OpenAiApiStyle = 'responses' | 'chat-completions'

export type StubProviderConfig = {
  provider: 'stub'
  defaultModel?: undefined
  defaultModelSource?: undefined
}

export type AnthropicProviderConfig = {
  provider: 'anthropic'
  apiKey?: string
  baseUrl: string
  defaultModel?: string
  defaultModelSource?: Exclude<ModelSelectionSource, 'cli' | 'none'>
}

export type OpenAiProviderConfig = {
  provider: 'openai'
  apiKey?: string
  baseUrl: string
  defaultModel?: string
  defaultModelSource?: Exclude<ModelSelectionSource, 'cli' | 'none'>
  apiStyle: OpenAiApiStyle
  defaultTextVerbosity?: OpenAiTextVerbosity
  defaultReasoningEffort?: OpenAiReasoningEffort
  defaultStore?: boolean
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

function parseOpenAiTextVerbosity(
  value: string | undefined,
): OpenAiTextVerbosity | undefined {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  return undefined
}

function parseOpenAiReasoningEffort(
  value: string | undefined,
): OpenAiReasoningEffort | undefined {
  if (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high'
  ) {
    return value
  }
  return undefined
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === '0') {
    return false
  }
  return undefined
}

export function resolveAnthropicProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
  getEnvSource?: (
    key: string,
  ) => Exclude<ModelSelectionSource, 'cli' | 'none' | 'env'> | undefined,
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
    defaultModelSource:
      trimOrUndefined(env.DCLAW_ANTHROPIC_MODEL) !== undefined
        ? getEnvSource?.('DCLAW_ANTHROPIC_MODEL') ?? 'env'
        : trimOrUndefined(env.ANTHROPIC_MODEL) !== undefined
          ? getEnvSource?.('ANTHROPIC_MODEL') ?? 'env'
          : undefined,
  }
}

export function resolveOpenAiProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
  getEnvSource?: (
    key: string,
  ) => Exclude<ModelSelectionSource, 'cli' | 'none' | 'env'> | undefined,
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
    defaultModelSource:
      trimOrUndefined(env.DCLAW_OPENAI_MODEL) !== undefined
        ? getEnvSource?.('DCLAW_OPENAI_MODEL') ?? 'env'
        : trimOrUndefined(env.OPENAI_MODEL) !== undefined
          ? getEnvSource?.('OPENAI_MODEL') ?? 'env'
          : undefined,
    apiStyle: inferOpenAiApiStyle(baseUrl, env),
    defaultTextVerbosity: parseOpenAiTextVerbosity(
      trimOrUndefined(env.DCLAW_OPENAI_VERBOSITY) ??
        trimOrUndefined(env.OPENAI_VERBOSITY),
    ),
    defaultReasoningEffort: parseOpenAiReasoningEffort(
      trimOrUndefined(env.DCLAW_OPENAI_REASONING_EFFORT) ??
        trimOrUndefined(env.OPENAI_REASONING_EFFORT),
    ),
    defaultStore: parseOptionalBoolean(
      trimOrUndefined(env.DCLAW_OPENAI_STORE) ??
        trimOrUndefined(env.OPENAI_STORE),
    ),
  }
}

export function resolveProviderConfig(
  provider: LlmProviderName,
  env: NodeJS.ProcessEnv = process.env,
  getEnvSource?: (
    key: string,
  ) => Exclude<ModelSelectionSource, 'cli' | 'none' | 'env'> | undefined,
): ResolvedProviderConfig {
  switch (provider) {
    case 'anthropic':
      return resolveAnthropicProviderConfig(env, getEnvSource)
    case 'openai':
      return resolveOpenAiProviderConfig(env, getEnvSource)
    case 'stub':
      return {
        provider: 'stub',
      }
  }
}
