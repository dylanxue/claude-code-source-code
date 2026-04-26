import { createLlmClient } from './client.js'
import type { ResolvedLlmConfig } from './config.js'
import {
  canonicalizeModelName,
  resolveModelCapabilities,
  resolveModelCatalogEntry,
  resolveModelLimits,
} from './modelLimits.js'
import { resolveModelSelection, type ModelSelectionSource } from './modelSelection.js'
import {
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from './providerConfig.js'
import type { LlmProviderName } from './providerNames.js'
import type { LlmClient } from './types.js'

export type RuntimeSelectionSource = 'cli' | 'user_config' | 'workspace_config' | 'default'

export type ResolvedModelRuntimeConfig = {
  providerRef: string
  provider: LlmProviderName
  providerConfig: ResolvedProviderConfig
  model?: string
  canonicalModel?: string
  catalogMatch?: string
  modelSource: ModelSelectionSource
  modelLimits?: ReturnType<typeof resolveModelLimits>
  modelCapabilities: ReturnType<typeof resolveModelCapabilities>
  client: LlmClient
}

export type ResolvedLlmRuntimeConfig = {
  runtimeName?: string
  runtimeSource: RuntimeSelectionSource
  provider: LlmProviderName
  providerSource: RuntimeSelectionSource
  providerRef: string
  providerConfig: ResolvedProviderConfig
  model?: string
  canonicalModel?: string
  catalogMatch?: string
  modelSource: ModelSelectionSource
  modelLimits?: ReturnType<typeof resolveModelLimits>
  modelCapabilities: ReturnType<typeof resolveModelCapabilities>
  primary: ResolvedModelRuntimeConfig
  imageFallback?: ResolvedModelRuntimeConfig
}

function resolveSelectedRuntimeName(
  runtimeOverride: string | undefined,
  config: ResolvedLlmConfig,
): {
  runtimeName?: string
  runtimeSource: RuntimeSelectionSource
} {
  const cliRuntime = runtimeOverride?.trim()
  if (cliRuntime) {
    return {
      runtimeName: cliRuntime,
      runtimeSource: 'cli',
    }
  }

  const configuredRuntime = config.defaultRuntime?.trim()
  if (configuredRuntime) {
    return {
      runtimeName: configuredRuntime,
      runtimeSource: config.defaultRuntimeSource ?? 'default',
    }
  }

  const runtimeNames = Object.keys(config.runtimes)
  if (runtimeNames.length === 1) {
    const runtimeName = runtimeNames[0]
    return {
      runtimeName,
      runtimeSource: config.runtimeSources[runtimeName] ?? 'default',
    }
  }

  return {
    runtimeName: undefined,
    runtimeSource: 'default',
  }
}

function resolveProviderProfile(
  providerRef: string,
  config: ResolvedLlmConfig,
): ResolvedProviderConfig {
  if (providerRef === 'stub') {
    return { provider: 'stub' }
  }

  const profile = config.providers[providerRef]
  if (!profile) {
    throw new Error(`Unknown llm providerRef: ${providerRef}`)
  }

  return resolveProviderConfig(profile)
}

function resolveModelRuntime(
  value: {
    providerRef: string
    model?: string
  },
  modelOverride: string | undefined,
  defaultModelSource: Exclude<ModelSelectionSource, 'cli' | 'none' | 'env'>,
  config: ResolvedLlmConfig,
  env: NodeJS.ProcessEnv,
): ResolvedModelRuntimeConfig {
  const providerConfig = resolveProviderProfile(value.providerRef, config)
  const modelSelection = resolveModelSelection(
    modelOverride,
    value.model,
    defaultModelSource,
  )
  const provider = providerConfig.provider
  const canonicalModel = modelSelection.model
    ? canonicalizeModelName(modelSelection.model)
    : undefined
  const catalogMatch =
    provider === 'stub'
      ? undefined
      : resolveModelCatalogEntry(provider, modelSelection.model, {
          env,
          overrides: config.modelCatalogOverrides,
        })?.match

  return {
    providerRef: value.providerRef,
    provider,
    providerConfig,
    model: modelSelection.model,
    canonicalModel,
    catalogMatch,
    modelSource: modelSelection.source,
    modelLimits:
      provider === 'stub'
        ? undefined
        : resolveModelLimits(provider, modelSelection.model, {
            env,
            overrides: config.modelCatalogOverrides,
          }),
    modelCapabilities:
      provider === 'stub'
        ? { supportsImageInput: false, supportsPdfInput: false }
        : resolveModelCapabilities(provider, modelSelection.model, {
            env,
            overrides: config.modelCatalogOverrides,
          }),
    client: createLlmClient(providerConfig, env, config.modelCatalogOverrides),
  }
}

export function resolveLlmRuntimeConfig(
  options: {
    runtime?: string
    model?: string
  },
  config: ResolvedLlmConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlmRuntimeConfig {
  const selected = resolveSelectedRuntimeName(options.runtime, config)
  if (!selected.runtimeName) {
    const providerConfig: ResolvedProviderConfig = { provider: 'stub' }
    return {
      runtimeSource: 'default',
      provider: 'stub',
      providerSource: 'default',
      providerRef: 'stub',
      providerConfig,
      model: options.model?.trim() || undefined,
      canonicalModel: options.model?.trim()
        ? canonicalizeModelName(options.model)
        : undefined,
      catalogMatch: undefined,
      modelSource: options.model?.trim() ? 'cli' : 'none',
      modelLimits: undefined,
      modelCapabilities: { supportsImageInput: false, supportsPdfInput: false },
      primary: {
        providerRef: 'stub',
        provider: 'stub',
        providerConfig,
        model: options.model?.trim() || undefined,
        canonicalModel: options.model?.trim()
          ? canonicalizeModelName(options.model)
          : undefined,
        catalogMatch: undefined,
        modelSource: options.model?.trim() ? 'cli' : 'none',
        modelLimits: undefined,
        modelCapabilities: { supportsImageInput: false, supportsPdfInput: false },
        client: createLlmClient(providerConfig, env, config.modelCatalogOverrides),
      },
    }
  }

  const runtime = config.runtimes[selected.runtimeName]
  if (!runtime) {
    throw new Error(`Unknown llm runtime: ${selected.runtimeName}`)
  }

  const primary = resolveModelRuntime(
    runtime.primary,
    options.model,
    selected.runtimeSource === 'user_config' ? 'user_config' : 'workspace_config',
    config,
    env,
  )

  return {
    runtimeName: selected.runtimeName,
    runtimeSource: selected.runtimeSource,
    provider: primary.provider,
    providerSource: selected.runtimeSource,
    providerRef: primary.providerRef,
    providerConfig: primary.providerConfig,
    model: primary.model,
    canonicalModel: primary.canonicalModel,
    catalogMatch: primary.catalogMatch,
    modelSource: primary.modelSource,
    modelLimits: primary.modelLimits,
    modelCapabilities: primary.modelCapabilities,
    primary,
    ...(runtime.imageFallback
      ? {
          imageFallback: resolveModelRuntime(
            runtime.imageFallback,
            undefined,
            selected.runtimeSource === 'user_config' ? 'user_config' : 'workspace_config',
            config,
            env,
          ),
        }
      : {}),
  }
}
