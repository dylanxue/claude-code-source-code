import { normalizeBaseUrl, trimOrUndefined } from './providerUtils.js'
import type {
  OpenAiReasoningEffort,
  OpenAiTextVerbosity,
} from './types.js'
import { loadDclawConfigFiles, type ConfigEnvSource } from '../cli/configFile.js'

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export type ProviderProfileType = 'anthropic' | 'openai' | 'stub'
export type OpenAiApiStyle = 'responses' | 'chat-completions' | 'codex-responses'
export type LlmConfigSource = ConfigEnvSource | 'default' | 'cli'

type BaseProviderProfileConfig = {
  type: ProviderProfileType
  apiKey?: string
  baseURL?: string
  proxyURL?: string
}

export type AnthropicProviderProfileConfig = BaseProviderProfileConfig & {
  type: 'anthropic'
}

export type OpenAiProviderProfileConfig = BaseProviderProfileConfig & {
  type: 'openai'
  apiStyle?: OpenAiApiStyle
  requestDefaults?: {
    verbosity?: OpenAiTextVerbosity
    reasoningEffort?: OpenAiReasoningEffort
    store?: boolean
  }
}

export type StubProviderProfileConfig = {
  type: 'stub'
}

export type ProviderProfileConfig =
  | AnthropicProviderProfileConfig
  | OpenAiProviderProfileConfig
  | StubProviderProfileConfig

export type RuntimeModelConfig = {
  providerRef: string
  model?: string
}

export type RuntimeProfileConfig = {
  primary: RuntimeModelConfig
  imageFallback?: RuntimeModelConfig
}

export type ModelCatalogOverride = Partial<{
  contextWindow: number
  maxOutputTokens: number
  maxOutputTokensUpperLimit: number
  supportsImageInput: boolean
  supportsPdfInput: boolean
}>

export type ModelCatalogOverrides = Record<string, ModelCatalogOverride>

export type LlmConfig = {
  defaultRuntime?: string
  providers: Record<string, ProviderProfileConfig>
  runtimes: Record<string, RuntimeProfileConfig>
  modelCatalogOverrides?: ModelCatalogOverrides
}

export type ResolvedLlmConfig = LlmConfig & {
  defaultRuntimeSource?: Exclude<LlmConfigSource, 'cli' | 'default'>
  providerSources: Partial<Record<string, ConfigEnvSource>>
  runtimeSources: Partial<Record<string, ConfigEnvSource>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  return undefined
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function parseOpenAiApiStyle(value: unknown): OpenAiApiStyle | undefined {
  return value === 'responses' ||
    value === 'chat-completions' ||
    value === 'codex-responses'
    ? value
    : undefined
}

function parseOpenAiTextVerbosity(
  value: unknown,
): OpenAiTextVerbosity | undefined {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : undefined
}

function parseOpenAiReasoningEffort(
  value: unknown,
): OpenAiReasoningEffort | undefined {
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high'
    ? value
    : undefined
}

function parseProviderProfileConfig(
  name: string,
  value: unknown,
  path: string,
  source: 'user' | 'workspace',
): ProviderProfileConfig {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid dclaw config at ${path}: llm.providers.${name} must be an object`,
    )
  }

  const type = value.type
  if (type === 'stub') {
    return { type: 'stub' }
  }

  if (type === 'anthropic') {
    if (source === 'workspace' && parseOptionalString(value.apiKey)) {
      throw new Error(
        `Invalid dclaw config at ${path}: workspace llm.providers.${name}.apiKey is not allowed`,
      )
    }

    return {
      type: 'anthropic',
      ...(parseOptionalString(value.apiKey)
        ? { apiKey: parseOptionalString(value.apiKey) }
        : {}),
      baseURL: normalizeBaseUrl(
        parseOptionalString(value.baseURL),
        DEFAULT_ANTHROPIC_BASE_URL,
      ),
      ...(parseOptionalString(value.proxyURL)
        ? { proxyURL: parseOptionalString(value.proxyURL) }
        : {}),
    }
  }

  if (type === 'openai') {
    if (source === 'workspace' && parseOptionalString(value.apiKey)) {
      throw new Error(
        `Invalid dclaw config at ${path}: workspace llm.providers.${name}.apiKey is not allowed`,
      )
    }

    const requestDefaults = isRecord(value.requestDefaults)
      ? {
          ...(parseOpenAiTextVerbosity(value.requestDefaults.verbosity)
            ? {
                verbosity: parseOpenAiTextVerbosity(
                  value.requestDefaults.verbosity,
                ),
              }
            : {}),
          ...(parseOpenAiReasoningEffort(value.requestDefaults.reasoningEffort)
            ? {
                reasoningEffort: parseOpenAiReasoningEffort(
                  value.requestDefaults.reasoningEffort,
                ),
              }
            : {}),
          ...(parseOptionalBoolean(value.requestDefaults.store) !== undefined
            ? { store: parseOptionalBoolean(value.requestDefaults.store) }
            : {}),
        }
      : undefined

    return {
      type: 'openai',
      ...(parseOptionalString(value.apiKey)
        ? { apiKey: parseOptionalString(value.apiKey) }
        : {}),
      baseURL: normalizeBaseUrl(
        parseOptionalString(value.baseURL),
        DEFAULT_OPENAI_BASE_URL,
      ),
      ...(parseOpenAiApiStyle(value.apiStyle)
        ? { apiStyle: parseOpenAiApiStyle(value.apiStyle) }
        : {}),
      ...(parseOptionalString(value.proxyURL)
        ? { proxyURL: parseOptionalString(value.proxyURL) }
        : {}),
      ...(requestDefaults && Object.keys(requestDefaults).length > 0
        ? { requestDefaults }
        : {}),
    }
  }

  throw new Error(
    `Invalid dclaw config at ${path}: llm.providers.${name}.type must be one of stub, anthropic, openai`,
  )
}

function parseRuntimeModelConfig(
  section: string,
  value: unknown,
  path: string,
): RuntimeModelConfig {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid dclaw config at ${path}: ${section} must be an object`,
    )
  }

  const providerRef = parseOptionalString(value.providerRef)
  if (!providerRef) {
    throw new Error(
      `Invalid dclaw config at ${path}: ${section}.providerRef is required`,
    )
  }

  return {
    providerRef,
    ...(parseOptionalString(value.model)
      ? { model: parseOptionalString(value.model) }
      : {}),
  }
}

function parseRuntimeProfileConfig(
  name: string,
  value: unknown,
  path: string,
): RuntimeProfileConfig {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid dclaw config at ${path}: llm.runtimes.${name} must be an object`,
    )
  }

  if (!('primary' in value)) {
    throw new Error(
      `Invalid dclaw config at ${path}: llm.runtimes.${name}.primary is required`,
    )
  }

  return {
    primary: parseRuntimeModelConfig(
      `llm.runtimes.${name}.primary`,
      value.primary,
      path,
    ),
    ...(value.imageFallback !== undefined
      ? {
          imageFallback: parseRuntimeModelConfig(
            `llm.runtimes.${name}.imageFallback`,
            value.imageFallback,
            path,
          ),
        }
      : {}),
  }
}

function parsePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function parseModelCatalogOverrides(value: unknown): ModelCatalogOverrides | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const overrides: Record<string, ModelCatalogOverride> = {}
  for (const [match, entryValue] of Object.entries(value)) {
    if (!isRecord(entryValue)) {
      continue
    }

    const override: ModelCatalogOverride = {
      ...(parsePositiveNumber(entryValue.contextWindow)
        ? { contextWindow: parsePositiveNumber(entryValue.contextWindow) }
        : {}),
      ...(parsePositiveNumber(entryValue.maxOutputTokens)
        ? { maxOutputTokens: parsePositiveNumber(entryValue.maxOutputTokens) }
        : {}),
      ...(parsePositiveNumber(entryValue.maxOutputTokensUpperLimit)
        ? {
            maxOutputTokensUpperLimit: parsePositiveNumber(
              entryValue.maxOutputTokensUpperLimit,
            ),
          }
        : {}),
      ...(typeof entryValue.supportsImageInput === 'boolean'
        ? { supportsImageInput: entryValue.supportsImageInput }
        : {}),
      ...(typeof entryValue.supportsPdfInput === 'boolean'
        ? { supportsPdfInput: entryValue.supportsPdfInput }
        : {}),
    }
    if (Object.keys(override).length > 0) {
      overrides[match] = override
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined
}

function deepMergeModelCatalogOverrides(
  base: ModelCatalogOverrides | undefined,
  override: ModelCatalogOverrides | undefined,
): ModelCatalogOverrides | undefined {
  if (!base) {
    return override
  }
  if (!override) {
    return base
  }

  return {
    ...base,
    ...override,
  }
}

function parseLlmConfigSection(
  rawConfig: Record<string, unknown> | undefined,
  path: string,
  source: 'user' | 'workspace',
): {
  defaultRuntime?: string
  providers: Record<string, ProviderProfileConfig>
  runtimes: Record<string, RuntimeProfileConfig>
  modelCatalogOverrides?: ModelCatalogOverrides
} {
  const llm = rawConfig?.llm
  if (!isRecord(llm)) {
    return {
      providers: {},
      runtimes: {},
    }
  }

  const providers: Record<string, ProviderProfileConfig> = {}
  if (isRecord(llm.providers)) {
    for (const [name, value] of Object.entries(llm.providers)) {
      providers[name] = parseProviderProfileConfig(name, value, path, source)
    }
  }

  const runtimes: Record<string, RuntimeProfileConfig> = {}
  if (isRecord(llm.runtimes)) {
    for (const [name, value] of Object.entries(llm.runtimes)) {
      runtimes[name] = parseRuntimeProfileConfig(name, value, path)
    }
  }

  return {
    ...(parseOptionalString(llm.defaultRuntime)
      ? { defaultRuntime: parseOptionalString(llm.defaultRuntime) }
      : {}),
    providers,
    runtimes,
    ...(parseModelCatalogOverrides(llm.modelCatalogOverrides)
      ? { modelCatalogOverrides: parseModelCatalogOverrides(llm.modelCatalogOverrides) }
      : {}),
  }
}

export async function loadResolvedLlmConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedLlmConfig> {
  const {
    userConfig,
    workspaceConfig,
    userConfigPath,
    workspaceConfigPath,
  } = await loadDclawConfigFiles(cwd, env)

  const user = parseLlmConfigSection(userConfig, userConfigPath, 'user')
  const workspace = parseLlmConfigSection(
    workspaceConfig,
    workspaceConfigPath,
    'workspace',
  )

  const providers = {
    ...user.providers,
    ...workspace.providers,
  }
  const runtimes = {
    ...user.runtimes,
    ...workspace.runtimes,
  }
  const providerSources: Partial<Record<string, ConfigEnvSource>> = {}
  const runtimeSources: Partial<Record<string, ConfigEnvSource>> = {}

  for (const name of Object.keys(user.providers)) {
    providerSources[name] = 'user_config'
  }
  for (const name of Object.keys(workspace.providers)) {
    providerSources[name] = 'workspace_config'
  }
  for (const name of Object.keys(user.runtimes)) {
    runtimeSources[name] = 'user_config'
  }
  for (const name of Object.keys(workspace.runtimes)) {
    runtimeSources[name] = 'workspace_config'
  }

  return {
    ...(workspace.defaultRuntime
      ? {
          defaultRuntime: workspace.defaultRuntime,
          defaultRuntimeSource: 'workspace_config' as const,
        }
      : user.defaultRuntime
        ? {
            defaultRuntime: user.defaultRuntime,
            defaultRuntimeSource: 'user_config' as const,
          }
        : {}),
    providers,
    providerSources,
    runtimes,
    runtimeSources,
    modelCatalogOverrides: deepMergeModelCatalogOverrides(
      user.modelCatalogOverrides,
      workspace.modelCatalogOverrides,
    ),
  }
}
