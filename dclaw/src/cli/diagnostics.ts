import { existsSync } from 'node:fs'
import {
  getModelLimitsConfigPath,
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
import type { LlmProviderName } from '../llm/providerNames.js'

export type DiagnosticEnvSource = Exclude<RuntimeConfigSource, 'env' | 'default'>

export function statusLine(label: string, value: string): string {
  return `${label.padEnd(18)} ${value}`
}

export function getLimitsConfigStatus(): string {
  const filePath = getModelLimitsConfigPath()
  return existsSync(filePath) ? filePath : `not found (${filePath})`
}

export function appendModelLimitLines(
  lines: string[],
  provider: 'anthropic' | 'openai',
  model: string,
): void {
  const limits = resolveModelLimits(provider, model)
  const capabilities = resolveModelCapabilities(provider, model)
  lines.push(statusLine('context window', String(limits.contextWindow)))
  lines.push(statusLine('max output', String(limits.maxOutputTokens)))
  lines.push(
    statusLine('max output cap', String(limits.maxOutputTokensUpperLimit)),
  )
  lines.push(
    statusLine(
      'vision input',
      capabilities.supportsVisionInput ? 'supported' : 'not supported',
    ),
  )
}

function normalizeVisionProvider(
  value: string | undefined,
): LlmProviderName | undefined {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'anthropic':
    case 'anthropic-compatible':
      return 'anthropic'
    case 'openai':
    case 'openai-compatible':
      return 'openai'
    case 'stub':
      return 'stub'
    default:
      return undefined
  }
}

export function getConfiguredVisionRuntimeStatus(
  env: NodeJS.ProcessEnv,
): {
  provider?: LlmProviderName
  model?: string
} | undefined {
  const provider = normalizeVisionProvider(
    env.DCLAW_VISION_PROVIDER ?? env.VISION_PROVIDER,
  )
  if (!provider) {
    return undefined
  }

  return {
    provider,
    model:
      env.DCLAW_VISION_MODEL?.trim() ||
      env.VISION_MODEL?.trim() ||
      undefined,
  }
}

export function appendVisionRuntimeLines(
  lines: string[],
  env: NodeJS.ProcessEnv,
): void {
  const runtime = getConfiguredVisionRuntimeStatus(env)
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
