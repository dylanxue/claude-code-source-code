import { existsSync } from 'node:fs'
import { getModelLimitsConfigPath, resolveModelLimits } from '../llm/modelLimits.js'
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
  lines.push(statusLine('context window', String(limits.contextWindow)))
  lines.push(statusLine('max output', String(limits.maxOutputTokens)))
  lines.push(
    statusLine('max output cap', String(limits.maxOutputTokensUpperLimit)),
  )
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
