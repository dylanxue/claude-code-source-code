import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { LlmProviderName } from './providerNames.js'
import { trimOrUndefined } from './providerUtils.js'

export type ModelLimits = {
  contextWindow: number
  maxOutputTokens: number
  maxOutputTokensUpperLimit: number
}

type PartialModelLimits = Partial<ModelLimits>

type UserModelLimitsConfig = {
  providers?: Partial<Record<LlmProviderName, Record<string, PartialModelLimits>>>
}

type ModelLimitRule = {
  match: string
  limits: ModelLimits
}

const DEFAULT_ANTHROPIC_LIMITS: ModelLimits = {
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  maxOutputTokensUpperLimit: 64_000,
}

const DEFAULT_OPENAI_LIMITS: ModelLimits = {
  contextWindow: 400_000,
  maxOutputTokens: 128_000,
  maxOutputTokensUpperLimit: 128_000,
}

const COMPAT_MODEL_LIMIT_RULES: ModelLimitRule[] = [
  {
    match: 'kimi-k2.5',
    limits: {
      contextWindow: 256_000,
      maxOutputTokens: 32_768,
      maxOutputTokensUpperLimit: 32_768,
    },
  },
  {
    match: 'kimi-k2',
    limits: {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      maxOutputTokensUpperLimit: 16_384,
    },
  },
  {
    match: 'glm-4.5-air',
    limits: {
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 98_304,
    },
  },
  {
    match: 'glm-4.5-flash',
    limits: {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      maxOutputTokensUpperLimit: 16_384,
    },
  },
  {
    match: 'glm-4.5',
    limits: {
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 98_304,
    },
  },
  {
    match: 'minimax-m2.7',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 64_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'minimax-m2.5',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 64_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'minimax-m2',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 64_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
]

const ANTHROPIC_LIMIT_RULES: ModelLimitRule[] = [
  ...COMPAT_MODEL_LIMIT_RULES,
  {
    match: 'claude-opus-4-6',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'claude-sonnet-4-6',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'claude-opus-4-5',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      maxOutputTokensUpperLimit: 64_000,
    },
  },
  {
    match: 'claude-sonnet-4-5',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      maxOutputTokensUpperLimit: 64_000,
    },
  },
  {
    match: 'claude-sonnet-4',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      maxOutputTokensUpperLimit: 64_000,
    },
  },
  {
    match: 'claude-haiku-4-5',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      maxOutputTokensUpperLimit: 64_000,
    },
  },
  {
    match: 'claude-3-7-sonnet',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      maxOutputTokensUpperLimit: 64_000,
    },
  },
  {
    match: 'claude-3-5-sonnet',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      maxOutputTokensUpperLimit: 8_192,
    },
  },
  {
    match: 'claude-3-5-haiku',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      maxOutputTokensUpperLimit: 8_192,
    },
  },
  {
    match: 'claude-3-opus',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 4_096,
      maxOutputTokensUpperLimit: 4_096,
    },
  },
  {
    match: 'claude-3-sonnet',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      maxOutputTokensUpperLimit: 8_192,
    },
  },
  {
    match: 'claude-3-haiku',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 4_096,
      maxOutputTokensUpperLimit: 4_096,
    },
  },
]

const OPENAI_LIMIT_RULES: ModelLimitRule[] = [
  ...COMPAT_MODEL_LIMIT_RULES,
  {
    match: 'gpt-5.4-pro',
    limits: {
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5.4',
    limits: {
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5-pro',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 272_000,
      maxOutputTokensUpperLimit: 272_000,
    },
  },
  {
    match: 'gpt-4.1-mini',
    limits: {
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      maxOutputTokensUpperLimit: 32_768,
    },
  },
  {
    match: 'gpt-4.1-nano',
    limits: {
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      maxOutputTokensUpperLimit: 32_768,
    },
  },
  {
    match: 'gpt-4.1',
    limits: {
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      maxOutputTokensUpperLimit: 32_768,
    },
  },
  {
    match: 'codex-mini-latest',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      maxOutputTokensUpperLimit: 100_000,
    },
  },
  {
    match: 'o4-mini',
    limits: {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      maxOutputTokensUpperLimit: 100_000,
    },
  },
  {
    match: 'gpt-5-codex',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5.1-codex',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5.3',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5.2',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5.1',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5-mini',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5-nano',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
  {
    match: 'gpt-5',
    limits: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
    },
  },
]

function parsePositiveInt(value: string | undefined): number | undefined {
  const trimmed = trimOrUndefined(value)
  if (!trimmed) {
    return undefined
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

function getProviderDefaults(provider: LlmProviderName): ModelLimits {
  switch (provider) {
    case 'anthropic':
      return DEFAULT_ANTHROPIC_LIMITS
    case 'openai':
      return DEFAULT_OPENAI_LIMITS
    case 'stub':
      return DEFAULT_ANTHROPIC_LIMITS
  }

  const unsupportedProvider: never = provider
  throw new Error(`Unsupported provider: ${unsupportedProvider}`)
}

function getProviderRules(provider: LlmProviderName): ModelLimitRule[] {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_LIMIT_RULES
    case 'openai':
      return OPENAI_LIMIT_RULES
    case 'stub':
      return []
  }

  const unsupportedProvider: never = provider
  throw new Error(`Unsupported provider: ${unsupportedProvider}`)
}

function normalizeModelName(model: string | undefined): string {
  return model?.trim().toLowerCase() ?? ''
}

function mergeModelLimits(
  base: ModelLimits,
  override: PartialModelLimits | undefined,
): ModelLimits {
  if (!override) {
    return base
  }

  const merged: ModelLimits = {
    contextWindow: override.contextWindow ?? base.contextWindow,
    maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
    maxOutputTokensUpperLimit:
      override.maxOutputTokensUpperLimit ?? base.maxOutputTokensUpperLimit,
  }

  return sanitizeModelLimits(merged)
}

function sanitizeModelLimits(limits: ModelLimits): ModelLimits {
  const contextWindow =
    Number.isInteger(limits.contextWindow) && limits.contextWindow > 0
      ? limits.contextWindow
      : DEFAULT_ANTHROPIC_LIMITS.contextWindow

  const upperLimit =
    Number.isInteger(limits.maxOutputTokensUpperLimit) &&
    limits.maxOutputTokensUpperLimit > 0
      ? limits.maxOutputTokensUpperLimit
      : DEFAULT_ANTHROPIC_LIMITS.maxOutputTokensUpperLimit

  const maxOutputTokens =
    Number.isInteger(limits.maxOutputTokens) && limits.maxOutputTokens > 0
      ? Math.min(limits.maxOutputTokens, upperLimit)
      : Math.min(DEFAULT_ANTHROPIC_LIMITS.maxOutputTokens, upperLimit)

  return {
    contextWindow,
    maxOutputTokens,
    maxOutputTokensUpperLimit: upperLimit,
  }
}

function getBestMatchingRule(
  model: string,
  rules: Record<string, PartialModelLimits> | undefined,
): PartialModelLimits | undefined {
  if (!rules) {
    return undefined
  }

  let bestMatchKey: string | undefined
  let bestMatchValue: PartialModelLimits | undefined

  for (const [rawKey, value] of Object.entries(rules)) {
    const key = normalizeModelName(rawKey)
    if (key === '*') {
      if (!bestMatchValue) {
        bestMatchKey = key
        bestMatchValue = value
      }
      continue
    }

    if (
      key.length > 0 &&
      model.startsWith(key) &&
      (!bestMatchKey || key.length > bestMatchKey.length)
    ) {
      bestMatchKey = key
      bestMatchValue = value
    }
  }

  return bestMatchValue
}

function loadUserModelLimitsConfig(
  env: NodeJS.ProcessEnv = process.env,
): UserModelLimitsConfig | undefined {
  const inlineJson = trimOrUndefined(env.DCLAW_MODEL_LIMITS_JSON)
  if (inlineJson) {
    try {
      return JSON.parse(inlineJson) as UserModelLimitsConfig
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown JSON parse error'
      throw new Error(`Invalid DCLAW_MODEL_LIMITS_JSON: ${message}`)
    }
  }

  const configuredPath = trimOrUndefined(env.DCLAW_MODEL_LIMITS_FILE)
  const filePath = configuredPath
    ? resolve(configuredPath)
    : getModelLimitsConfigPath(env)
  if (!existsSync(filePath)) {
    return undefined
  }

  const content = readFileSync(filePath, 'utf8')
  if (content.trim().length === 0) {
    return undefined
  }

  try {
    return JSON.parse(content) as UserModelLimitsConfig
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown JSON parse error'
    throw new Error(`Invalid model limits config at ${filePath}: ${message}`)
  }
}

export function getModelLimitsConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredPath = trimOrUndefined(env.DCLAW_MODEL_LIMITS_FILE)
  if (configuredPath) {
    return resolve(configuredPath)
  }

  const home = trimOrUndefined(env.HOME) ?? homedir()
  return resolve(home, '.dclaw/model-limits.json')
}

export function getBuiltInModelLimits(
  provider: LlmProviderName,
  model: string | undefined,
): ModelLimits {
  const normalizedModel = normalizeModelName(model)
  const defaults = getProviderDefaults(provider)

  if (normalizedModel.length === 0) {
    return defaults
  }

  for (const rule of getProviderRules(provider)) {
    if (normalizedModel.startsWith(rule.match)) {
      return rule.limits
    }
  }

  return defaults
}

export function resolveModelLimits(
  provider: LlmProviderName,
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ModelLimits {
  const normalizedModel = normalizeModelName(model)
  const builtIn = getBuiltInModelLimits(provider, normalizedModel)
  const userConfig = loadUserModelLimitsConfig(env)
  const providerRules = userConfig?.providers?.[provider]
  const userOverride = getBestMatchingRule(normalizedModel, providerRules)
  let limits = mergeModelLimits(builtIn, userOverride)

  const contextOverride = parsePositiveInt(env.DCLAW_MAX_CONTEXT_TOKENS)
  const maxOutputOverride = parsePositiveInt(env.DCLAW_MAX_OUTPUT_TOKENS)
  const upperLimitOverride = parsePositiveInt(
    env.DCLAW_MAX_OUTPUT_TOKENS_UPPER_LIMIT,
  )

  limits = sanitizeModelLimits({
    contextWindow: contextOverride ?? limits.contextWindow,
    maxOutputTokens: maxOutputOverride ?? limits.maxOutputTokens,
    maxOutputTokensUpperLimit:
      upperLimitOverride ?? limits.maxOutputTokensUpperLimit,
  })

  return limits
}
