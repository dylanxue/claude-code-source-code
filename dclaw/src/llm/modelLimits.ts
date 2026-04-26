import modelCatalogJson from './modelCatalog.json' with { type: 'json' }
import type { ModelCatalogOverrides } from './config.js'
import type { LlmProviderName } from './providerNames.js'
import { trimOrUndefined } from './providerUtils.js'

export type ModelLimits = {
  contextWindow: number
  maxOutputTokens: number
  maxOutputTokensUpperLimit: number
}

export type ModelCapabilities = {
  supportsImageInput: boolean
  supportsPdfInput: boolean
}

export type ModelCatalogEntry = Partial<ModelLimits> &
  Partial<ModelCapabilities> & {
    match: string
  }

type ModelCatalog = {
  entries: ModelCatalogEntry[]
}

export type ModelResolutionOptions = {
  env?: NodeJS.ProcessEnv
  overrides?: ModelCatalogOverrides
}

const MODEL_CATALOG = modelCatalogJson as ModelCatalog

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

function normalizeModelName(model: string | undefined): string {
  return model?.trim().toLowerCase() ?? ''
}

function canonicalizeClaudeModelName(model: string): string {
  const withoutVendorPrefix = model.startsWith('anthropic/')
    ? model.slice('anthropic/'.length)
    : model

  if (!withoutVendorPrefix.startsWith('claude-')) {
    return withoutVendorPrefix
  }

  // Anthropic API uses hyphenated version segments such as `claude-opus-4-6`,
  // while gateways like OpenRouter often expose dotted ids like
  // `anthropic/claude-opus-4.6`. Canonicalize both to the Anthropic-style id.
  return withoutVendorPrefix.replace(/(\d+)\.(\d+)/g, '$1-$2')
}

export function canonicalizeModelName(model: string | undefined): string {
  const normalized = normalizeModelName(model)
  if (normalized.length === 0) {
    return normalized
  }

  if (
    normalized.startsWith('claude-') ||
    normalized.startsWith('anthropic/claude-')
  ) {
    return canonicalizeClaudeModelName(normalized)
  }

  return normalized
}

const PROVIDER_DEFAULTS: Record<LlmProviderName, ModelLimits & ModelCapabilities> = {
  anthropic: {
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 64_000,
    supportsImageInput: true,
    supportsPdfInput: true,
  },
  openai: {
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    maxOutputTokensUpperLimit: 128_000,
    supportsImageInput: true,
    supportsPdfInput: true,
  },
  stub: {
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 64_000,
    supportsImageInput: false,
    supportsPdfInput: false,
  },
}

function getProviderDefaults(
  provider: LlmProviderName,
): ModelLimits & ModelCapabilities {
  return PROVIDER_DEFAULTS[provider]
}

function getBestMatchingEntry<T extends { match: string }>(
  model: string,
  entries: T[],
): T | undefined {
  let bestMatch: T | undefined
  let bestMatchLength = -1

  for (const entry of entries) {
    const match = normalizeModelName(entry.match)
    if (match.length === 0) {
      continue
    }
    if (!model.startsWith(match)) {
      continue
    }
    if (match.length > bestMatchLength) {
      bestMatch = entry
      bestMatchLength = match.length
    }
  }

  return bestMatch
}

function getBestMatchingOverride(
  model: string,
  overrides: Partial<Record<string, Partial<ModelLimits & ModelCapabilities>>> | undefined,
): Partial<ModelLimits & ModelCapabilities> | undefined {
  if (!overrides) {
    return undefined
  }

  let bestMatchKey: string | undefined
  let bestMatchValue: Partial<ModelLimits & ModelCapabilities> | undefined

  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = canonicalizeModelName(rawKey)
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

function sanitizeModelLimits(limits: ModelLimits): ModelLimits {
  const contextWindow =
    Number.isInteger(limits.contextWindow) && limits.contextWindow > 0
      ? limits.contextWindow
      : 200_000

  const upperLimit =
    Number.isInteger(limits.maxOutputTokensUpperLimit) &&
    limits.maxOutputTokensUpperLimit > 0
      ? limits.maxOutputTokensUpperLimit
      : 64_000

  const maxOutputTokens =
    Number.isInteger(limits.maxOutputTokens) && limits.maxOutputTokens > 0
      ? Math.min(limits.maxOutputTokens, upperLimit)
      : Math.min(32_000, upperLimit)

  return {
    contextWindow,
    maxOutputTokens,
    maxOutputTokensUpperLimit: upperLimit,
  }
}

function mergeModelLimits(
  base: ModelLimits,
  override: Partial<ModelLimits> | undefined,
): ModelLimits {
  if (!override) {
    return base
  }

  return sanitizeModelLimits({
    contextWindow: override.contextWindow ?? base.contextWindow,
    maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
    maxOutputTokensUpperLimit:
      override.maxOutputTokensUpperLimit ?? base.maxOutputTokensUpperLimit,
  })
}

function normalizeResolutionOptions(
  input: NodeJS.ProcessEnv | ModelResolutionOptions | undefined,
): ModelResolutionOptions {
  const isResolutionOptions = (
    value: NodeJS.ProcessEnv | ModelResolutionOptions,
  ): value is ModelResolutionOptions =>
    Object.prototype.hasOwnProperty.call(value, 'env') ||
    Object.prototype.hasOwnProperty.call(value, 'overrides')

  if (!input) {
    return { env: process.env }
  }

  if (isResolutionOptions(input)) {
    return {
      env: input.env ?? process.env,
      overrides: input.overrides,
    }
  }

  return {
    env: input,
  }
}

export function getBuiltInModelCatalogEntry(
  _provider: LlmProviderName,
  model: string | undefined,
): ModelCatalogEntry | undefined {
  const normalizedModel = canonicalizeModelName(model)
  if (normalizedModel.length === 0) {
    return undefined
  }

  return getBestMatchingEntry(normalizedModel, MODEL_CATALOG.entries)
}

export function getBuiltInModelLimits(
  provider: LlmProviderName,
  model: string | undefined,
): ModelLimits {
  const defaults = getProviderDefaults(provider)
  const entry = getBuiltInModelCatalogEntry(provider, model)
  return mergeModelLimits(defaults, entry)
}

export function getBuiltInModelCapabilities(
  provider: LlmProviderName,
  model: string | undefined,
): ModelCapabilities {
  const defaults = getProviderDefaults(provider)
  const entry = getBuiltInModelCatalogEntry(provider, model)

  return {
    supportsImageInput:
      entry?.supportsImageInput ?? defaults.supportsImageInput,
    supportsPdfInput:
      entry?.supportsPdfInput ?? defaults.supportsPdfInput,
  }
}

export function resolveModelCatalogEntry(
  provider: LlmProviderName,
  model: string | undefined,
  options: NodeJS.ProcessEnv | ModelResolutionOptions = process.env,
): ModelCatalogEntry | undefined {
  const normalizedModel = canonicalizeModelName(model)
  const builtIn = getBuiltInModelCatalogEntry(provider, normalizedModel)
  const { overrides } = normalizeResolutionOptions(options)
  const override = getBestMatchingOverride(
    normalizedModel,
    overrides,
  )

  if (!builtIn && !override) {
    return undefined
  }

  return {
    match: normalizedModel,
    ...(builtIn ?? {}),
    ...(override ?? {}),
  }
}

export function resolveModelLimits(
  provider: LlmProviderName,
  model: string | undefined,
  options: NodeJS.ProcessEnv | ModelResolutionOptions = process.env,
): ModelLimits {
  const normalizedModel = canonicalizeModelName(model)
  const builtIn = getBuiltInModelLimits(provider, normalizedModel)
  const { env, overrides } = normalizeResolutionOptions(options)
  const override = getBestMatchingOverride(
    normalizedModel,
    overrides,
  )
  let limits = mergeModelLimits(builtIn, override)

  const contextOverride = parsePositiveInt(env?.DCLAW_MAX_CONTEXT_TOKENS)
  const maxOutputOverride = parsePositiveInt(env?.DCLAW_MAX_OUTPUT_TOKENS)
  const upperLimitOverride = parsePositiveInt(
    env?.DCLAW_MAX_OUTPUT_TOKENS_UPPER_LIMIT,
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
  options: NodeJS.ProcessEnv | ModelResolutionOptions = process.env,
): ModelCapabilities {
  const normalizedModel = canonicalizeModelName(model)
  const builtIn = getBuiltInModelCapabilities(provider, normalizedModel)
  const { overrides } = normalizeResolutionOptions(options)
  const override = getBestMatchingOverride(
    normalizedModel,
    overrides,
  )

  return {
    supportsImageInput:
      override?.supportsImageInput ?? builtIn.supportsImageInput,
    supportsPdfInput:
      override?.supportsPdfInput ?? builtIn.supportsPdfInput,
  }
}
