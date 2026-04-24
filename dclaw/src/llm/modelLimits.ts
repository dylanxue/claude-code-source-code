import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getDclawHomeDir } from '../session/paths.js'
import type { LlmProviderName } from './providerNames.js'
import { trimOrUndefined } from './providerUtils.js'

export type ModelLimits = {
  contextWindow: number
  maxOutputTokens: number
  maxOutputTokensUpperLimit: number
}

export type ModelCapabilities = {
  supportsVisionInput: boolean
}

type PartialModelMetadata = Partial<ModelLimits> & {
  supportsVisionInput?: boolean
}

type UserModelLimitsConfig = {
  providers?: Partial<Record<LlmProviderName, Record<string, PartialModelMetadata>>>
}

type ModelLimitRule = {
  match: string
  limits: ModelLimits
}

type ModelCapabilityRule = {
  match: string
  capabilities: ModelCapabilities
}

function buildAliasRules(
  matches: string[],
  limits: ModelLimits,
): ModelLimitRule[] {
  return matches.map((match) => ({ match, limits }))
}

function buildCapabilityAliasRules(
  matches: string[],
  capabilities: ModelCapabilities,
): ModelCapabilityRule[] {
  return matches.map((match) => ({ match, capabilities }))
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

const DEFAULT_ANTHROPIC_CAPABILITIES: ModelCapabilities = {
  supportsVisionInput: true,
}

const DEFAULT_OPENAI_CAPABILITIES: ModelCapabilities = {
  supportsVisionInput: true,
}

const DEFAULT_STUB_CAPABILITIES: ModelCapabilities = {
  supportsVisionInput: false,
}

const VISION_INPUT_SUPPORTED: ModelCapabilities = {
  supportsVisionInput: true,
}

const VISION_INPUT_NOT_SUPPORTED: ModelCapabilities = {
  supportsVisionInput: false,
}

const DOUBAO_SEED_CODE_LIMITS: ModelLimits = {
  contextWindow: 256_000,
  maxOutputTokens: 32_000,
  maxOutputTokensUpperLimit: 32_000,
}

const DOUBAO_SEED_1_6_LIMITS: ModelLimits = {
  contextWindow: 256_000,
  maxOutputTokens: 32_000,
  maxOutputTokensUpperLimit: 32_000,
}

const DOUBAO_SEED_1_8_LIMITS: ModelLimits = {
  contextWindow: 256_000,
  maxOutputTokens: 64_000,
  maxOutputTokensUpperLimit: 64_000,
}

const DOUBAO_SEED_2_0_LIMITS: ModelLimits = {
  contextWindow: 256_000,
  maxOutputTokens: 32_000,
  maxOutputTokensUpperLimit: 128_000,
}

const COMPAT_MODEL_LIMIT_RULES: ModelLimitRule[] = [
  ...buildAliasRules(
    ['bytedance-seed-code', 'doubao-seed-code'],
    DOUBAO_SEED_CODE_LIMITS,
  ),
  ...buildAliasRules(['doubao-seed-2.0-code'], DOUBAO_SEED_2_0_LIMITS),
  ...buildAliasRules(
    ['seed-1.6', 'seed-1-6', 'doubao-seed-1.6'],
    DOUBAO_SEED_1_6_LIMITS,
  ),
  ...buildAliasRules(
    ['seed-1.6-flash', 'seed-1-6-flash', 'doubao-seed-1.6-flash'],
    DOUBAO_SEED_1_6_LIMITS,
  ),
  ...buildAliasRules(
    ['seed-1.8', 'seed-1-8', 'doubao-seed-1.8'],
    DOUBAO_SEED_1_8_LIMITS,
  ),
  ...buildAliasRules(
    ['dola-seed-2.0-pro', 'seed-2.0-pro', 'seed-2-0-pro', 'doubao-seed-2.0-pro'],
    DOUBAO_SEED_2_0_LIMITS,
  ),
  ...buildAliasRules(
    [
      'dola-seed-2.0-lite',
      'seed-2.0-lite',
      'seed-2-0-lite',
      'doubao-seed-2.0-lite',
    ],
    DOUBAO_SEED_2_0_LIMITS,
  ),
  ...buildAliasRules(
    ['seed-2.0-mini', 'seed-2-0-mini', 'doubao-seed-2.0-mini'],
    DOUBAO_SEED_2_0_LIMITS,
  ),
  {
    match: 'deepseek-chat',
    limits: {
      contextWindow: 131_072,
      maxOutputTokens: 4_096,
      maxOutputTokensUpperLimit: 8_192,
    },
  },
  {
    match: 'deepseek-v3.2',
    limits: {
      contextWindow: 131_072,
      maxOutputTokens: 4_096,
      maxOutputTokensUpperLimit: 8_192,
    },
  },
  {
    match: 'deepseek-reasoner',
    limits: {
      contextWindow: 131_072,
      maxOutputTokens: 32_768,
      maxOutputTokensUpperLimit: 65_536,
    },
  },
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
    match: 'glm-5.1',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 131_072,
    },
  },
  {
    match: 'glm-5-turbo',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 131_072,
    },
  },
  {
    match: 'glm-5',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 131_072,
    },
  },
  {
    match: 'glm-4.7-flashx',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 131_072,
    },
  },
  {
    match: 'glm-4.7-flash',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 131_072,
    },
  },
  {
    match: 'glm-4.7',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 131_072,
    },
  },
  {
    match: 'glm-4.6',
    limits: {
      contextWindow: 204_800,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 131_072,
    },
  },
  {
    match: 'glm-4.5-airx',
    limits: {
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 98_304,
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
    match: 'glm-4.5-x',
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
      maxOutputTokens: 65_536,
      maxOutputTokensUpperLimit: 98_304,
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

const COMPAT_MODEL_CAPABILITY_RULES: ModelCapabilityRule[] = [
  ...buildCapabilityAliasRules(
    ['doubao-seed-code', 'bytedance-seed-code'],
    VISION_INPUT_SUPPORTED,
  ),
  ...buildCapabilityAliasRules(
    ['doubao-seed-2.0', 'seed-2.0', 'seed-2-0', 'dola-seed-2.0'],
    VISION_INPUT_SUPPORTED,
  ),
  ...buildCapabilityAliasRules(
    ['doubao-seed-1.8', 'seed-1.8', 'seed-1-8'],
    VISION_INPUT_SUPPORTED,
  ),
  ...buildCapabilityAliasRules(
    ['doubao-seed-1.6', 'seed-1.6', 'seed-1-6'],
    VISION_INPUT_SUPPORTED,
  ),
  ...buildCapabilityAliasRules(['kimi-k2.5'], VISION_INPUT_SUPPORTED),
  ...buildCapabilityAliasRules(['kimi-k2'], VISION_INPUT_NOT_SUPPORTED),
  ...buildCapabilityAliasRules(
    ['glm-4.5v', 'glm-5v', 'glm-5v-turbo', 'glm-4.1v', 'glm-ocr'],
    VISION_INPUT_SUPPORTED,
  ),
  ...buildCapabilityAliasRules(
    ['glm-5.1', 'glm-5-turbo', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5'],
    VISION_INPUT_NOT_SUPPORTED,
  ),
  ...buildCapabilityAliasRules(
    ['deepseek-chat', 'deepseek-v3.2', 'deepseek-reasoner'],
    VISION_INPUT_NOT_SUPPORTED,
  ),
  ...buildCapabilityAliasRules(
    ['minimax-m2.7', 'minimax-m2.5', 'minimax-m2.1', 'minimax-m2'],
    VISION_INPUT_NOT_SUPPORTED,
  ),
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

const ANTHROPIC_CAPABILITY_RULES: ModelCapabilityRule[] = [
  ...COMPAT_MODEL_CAPABILITY_RULES,
  ...buildCapabilityAliasRules(['claude-'], VISION_INPUT_SUPPORTED),
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

const OPENAI_CAPABILITY_RULES: ModelCapabilityRule[] = [
  ...COMPAT_MODEL_CAPABILITY_RULES,
  ...buildCapabilityAliasRules(
    [
      'gpt-4.1',
      'gpt-5',
      'gpt-5.1',
      'gpt-5.2',
      'gpt-5.3',
      'gpt-5.4',
      'gpt-5-codex',
      'gpt-5.1-codex',
      'codex-mini-latest',
      'o4-mini',
    ],
    VISION_INPUT_SUPPORTED,
  ),
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

function getProviderCapabilityRules(
  provider: LlmProviderName,
): ModelCapabilityRule[] {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_CAPABILITY_RULES
    case 'openai':
      return OPENAI_CAPABILITY_RULES
    case 'stub':
      return []
  }

  const unsupportedProvider: never = provider
  throw new Error(`Unsupported provider: ${unsupportedProvider}`)
}

function getProviderDefaultCapabilities(
  provider: LlmProviderName,
): ModelCapabilities {
  switch (provider) {
    case 'anthropic':
      return DEFAULT_ANTHROPIC_CAPABILITIES
    case 'openai':
      return DEFAULT_OPENAI_CAPABILITIES
    case 'stub':
      return DEFAULT_STUB_CAPABILITIES
  }

  const unsupportedProvider: never = provider
  throw new Error(`Unsupported provider: ${unsupportedProvider}`)
}

function normalizeModelName(model: string | undefined): string {
  return model?.trim().toLowerCase() ?? ''
}

function mergeModelLimits(
  base: ModelLimits,
  override: Partial<ModelLimits> | undefined,
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

function getBestMatchingRule<T>(
  model: string,
  rules: Record<string, T> | undefined,
): T | undefined {
  if (!rules) {
    return undefined
  }

  let bestMatchKey: string | undefined
  let bestMatchValue: T | undefined

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

  return resolve(getDclawHomeDir(env), 'model-limits.json')
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

export function getBuiltInModelCapabilities(
  provider: LlmProviderName,
  model: string | undefined,
): ModelCapabilities {
  const normalizedModel = normalizeModelName(model)
  const defaults = getProviderDefaultCapabilities(provider)

  if (normalizedModel.length === 0) {
    return defaults
  }

  for (const rule of getProviderCapabilityRules(provider)) {
    if (normalizedModel.startsWith(rule.match)) {
      return rule.capabilities
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

export function resolveModelCapabilities(
  provider: LlmProviderName,
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ModelCapabilities {
  const normalizedModel = normalizeModelName(model)
  const builtIn = getBuiltInModelCapabilities(provider, normalizedModel)
  const userConfig = loadUserModelLimitsConfig(env)
  const providerRules = userConfig?.providers?.[provider]
  const userOverride = getBestMatchingRule(normalizedModel, providerRules)

  return {
    supportsVisionInput:
      userOverride?.supportsVisionInput ?? builtIn.supportsVisionInput,
  }
}
