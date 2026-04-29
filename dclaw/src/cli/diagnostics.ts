import {
  canonicalizeModelName,
  type ModelResolutionOptions,
  resolveModelCatalogEntry,
  resolveModelCapabilities,
  resolveModelLimits,
} from '../llm/modelLimits.js'
import {
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_JITTER_RATIO,
  DEFAULT_RETRY_MAX_DELAY_MS,
  resolveLlmMaxRetries,
  resolveLlmRequestTimeoutMs,
  resolveStreamIdleTimeoutMs,
  resolveStreamWatchdogEnabled,
  type RuntimeConfigSource,
} from '../llm/providerUtils.js'
import {
  resolveLlmProxyConfig,
  type LlmProxyConfig,
} from '../llm/proxy.js'
import type { LlmProviderName } from '../llm/providerNames.js'
import type { ResolvedModelRuntimeConfig } from '../llm/runtimeConfig.js'

export type DiagnosticEnvSource = Exclude<RuntimeConfigSource, 'env' | 'default'>

export function statusLine(label: string, value: string): string {
  return `${label.padEnd(18)} ${value}`
}

export function getLimitsConfigStatus(): string {
  return 'built-in + llm.modelCatalogOverrides'
}

export function appendModelLimitLines(
  lines: string[],
  provider: 'anthropic' | 'openai',
  model: string,
  options?: ModelResolutionOptions,
): void {
  const canonicalModel = canonicalizeModelName(model)
  const catalogEntry = resolveModelCatalogEntry(provider, model, options)
  const limits = resolveModelLimits(provider, model, options)
  const capabilities = resolveModelCapabilities(provider, model, options)
  lines.push(statusLine('canonical model', canonicalModel))
  lines.push(statusLine('catalog match', catalogEntry?.match ?? 'none'))
  lines.push(statusLine('context window', String(limits.contextWindow)))
  lines.push(statusLine('max output', String(limits.maxOutputTokens)))
  lines.push(
    statusLine('max output cap', String(limits.maxOutputTokensUpperLimit)),
  )
  lines.push(
    statusLine(
      'image input',
      capabilities.supportsImageInput ? 'supported' : 'not supported',
    ),
  )
  lines.push(
    statusLine(
      'pdf input',
      capabilities.supportsPdfInput ? 'supported' : 'not supported',
    ),
  )
}

export function appendVisionRuntimeLines(
  lines: string[],
  runtime: ResolvedModelRuntimeConfig | undefined,
): void {
  if (!runtime) {
    lines.push(statusLine('vision side query', 'not configured'))
    return
  }

  lines.push(statusLine('vision side query', 'configured'))
  lines.push(statusLine('vision provider', runtime.provider ?? 'unknown'))
  lines.push(statusLine('vision model', runtime.model ?? 'default'))
}

export function appendReliabilityConfigLines(
  lines: string[],
  env: NodeJS.ProcessEnv,
  getEnvSource?: (key: string) => DiagnosticEnvSource | undefined,
): void {
  const maxRetries = resolveLlmMaxRetries(env, getEnvSource)
  const requestTimeout = resolveLlmRequestTimeoutMs(env, getEnvSource)
  const streamWatchdog = resolveStreamWatchdogEnabled(env, getEnvSource)
  const streamIdleTimeout = resolveStreamIdleTimeoutMs(env, getEnvSource)

  lines.push(
    statusLine(
      'max retries',
      `${maxRetries.value} (${maxRetries.source})`,
    ),
  )
  lines.push(
    statusLine(
      'retry backoff',
      `${DEFAULT_RETRY_INITIAL_DELAY_MS}ms exp, cap ${DEFAULT_RETRY_MAX_DELAY_MS}ms, jitter ${Math.round(DEFAULT_RETRY_JITTER_RATIO * 100)}%`,
    ),
  )
  lines.push(
    statusLine(
      'request timeout',
      `${requestTimeout.value}ms (${requestTimeout.source})`,
    ),
  )
  lines.push(
    statusLine(
      'stream watchdog',
      `${streamWatchdog.value ? 'enabled' : 'disabled'} (${streamWatchdog.source})`,
    ),
  )
  lines.push(
    statusLine(
      'stream idle timeout',
      `${streamIdleTimeout.value}ms (${streamIdleTimeout.source})`,
    ),
  )
}

export function appendProxyConfigLines(
  lines: string[],
  config: LlmProxyConfig | undefined,
  env: NodeJS.ProcessEnv,
): void {
  const proxy = resolveLlmProxyConfig(config, env)
  lines.push(
    statusLine(
      'proxy',
      proxy.proxyUrl ? `${proxy.proxyUrl} (${proxy.source})` : 'not configured',
    ),
  )
}
