import { createParser } from 'eventsource-parser'
import {
  formatPersistedToolResultOutput,
  isPersistedToolResultOutput,
} from '../core/toolResultBudget.js'

type ErrorMessageShape = {
  error?: {
    message?: unknown
    type?: unknown
    code?: unknown
  }
}

export type SseEvent = {
  event?: string
  data: string
}

export type ReadSseEventsOptions = {
  idleTimeoutMs?: number
  onChunk?: (chunk: Uint8Array) => void
}

export type SleepImpl = (ms: number) => Promise<void>

export type RuntimeConfigSource =
  | 'env'
  | 'user_config'
  | 'workspace_config'
  | 'default'

export const DEFAULT_LLM_MAX_RETRIES = 10
export const DEFAULT_LLM_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90 * 1000
export const DEFAULT_RETRY_INITIAL_DELAY_MS = 500
export const DEFAULT_RETRY_MAX_DELAY_MS = 32 * 1000
export const DEFAULT_RETRY_JITTER_RATIO = 0.25

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'overloaded'
  | 'bad_request'
  | 'server_error'
  | 'network'
  | 'unknown'

export type ProviderErrorSubtype =
  | 'invalid_api_key'
  | 'token_revoked'
  | 'auth_error'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'server_overload'
  | 'model_not_found'
  | 'invalid_model'
  | 'prompt_too_long'
  | 'tool_use_mismatch'
  | 'request_too_large'
  | 'bad_request'
  | 'server_error'
  | 'network_error'
  | 'unknown'

export type HttpErrorDetails = {
  message: string
  type?: string
  code?: string
}

export type ProviderErrorClassification = {
  kind: ProviderErrorKind
  subtype: ProviderErrorSubtype
  userMessage: string
}

export class RetryableHttpError extends Error {
  readonly providerName: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly kind: ProviderErrorKind
  readonly subtype: ProviderErrorSubtype
  readonly userMessage: string
  readonly errorType?: string
  readonly errorCode?: string
  readonly retryDirective?: boolean

  constructor(
    providerName: string,
    status: number,
    statusText: string,
    details: HttpErrorDetails,
    headers: Headers,
  ) {
    super(
      `${providerName} request failed (${status} ${statusText}): ${details.message}`,
    )
    this.name = 'RetryableHttpError'
    this.providerName = providerName
    this.status = status
    this.statusText = statusText
    this.headers = headers
    this.errorType = details.type
    this.errorCode = details.code
    this.retryDirective = getShouldRetryDirective(headers)
    const classification = classifyProviderHttpError({
      providerName,
      status,
      message: details.message,
      errorType: details.type,
      errorCode: details.code,
    })
    this.kind = classification.kind
    this.subtype = classification.subtype
    this.userMessage = classification.userMessage
  }
}

export class NonRetryableError extends Error {
  readonly causeValue: unknown

  constructor(causeValue: unknown) {
    super(causeValue instanceof Error ? causeValue.message : 'Non-retryable error')
    this.name = 'NonRetryableError'
    this.causeValue = causeValue
  }
}

export class ProviderTimeoutError extends TypeError {
  readonly timeoutMs: number

  constructor(message: string, timeoutMs: number) {
    super(message)
    this.name = 'ProviderTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export function trimOrUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function normalizeBaseUrl(
  value: string | undefined,
  fallback: string,
): string {
  const resolved = trimOrUndefined(value) ?? fallback
  return resolved.replace(/\/+$/, '')
}

export function stringifyJson(value: unknown): string {
  if (isPersistedToolResultOutput(value)) {
    return formatPersistedToolResultOutput(value)
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function coerceHttpErrorToken(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return undefined
}

export async function getHttpErrorDetails(
  response: Response,
): Promise<HttpErrorDetails> {
  try {
    const text = await response.text()
    const parsed = JSON.parse(text) as ErrorMessageShape
    const message = coerceHttpErrorToken(parsed.error?.message)
    const type = coerceHttpErrorToken(parsed.error?.type)
    const code = coerceHttpErrorToken(parsed.error?.code)
    if (message) {
      return {
        message,
        ...(type ? { type } : {}),
        ...(code ? { code } : {}),
      }
    }
    if (text.trim().length > 0) {
      return {
        message: text.trim(),
      }
    }
  } catch {}

  return {
    message: `HTTP ${response.status}`,
  }
}

export async function getHttpErrorMessage(response: Response): Promise<string> {
  return (await getHttpErrorDetails(response)).message
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function parsePositiveInteger(
  raw: string | undefined,
): number | undefined {
  if (!raw) {
    return undefined
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined
  }

  return Math.floor(parsed)
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  const normalized = trimOrUndefined(value)?.toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  ) {
    return true
  }

  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off'
  ) {
    return false
  }

  return undefined
}

function resolvePositiveIntegerSetting(
  raw: string | undefined,
  key: string,
  fallback: number,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): {
  value: number
  source: RuntimeConfigSource
} {
  const parsed = parsePositiveInteger(raw)
  if (parsed !== undefined) {
    return {
      value: parsed,
      source: getEnvSource?.(key) ?? 'env',
    }
  }

  return {
    value: fallback,
    source: 'default',
  }
}

function resolveBooleanFlagSetting(
  raw: string | undefined,
  key: string,
  fallback: boolean,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): {
  value: boolean
  source: RuntimeConfigSource
} {
  const parsed = parseBooleanFlag(raw)
  if (parsed !== undefined) {
    return {
      value: parsed,
      source: getEnvSource?.(key) ?? 'env',
    }
  }

  return {
    value: fallback,
    source: 'default',
  }
}

export function resolveLlmMaxRetries(
  env: NodeJS.ProcessEnv,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): {
  value: number
  source: RuntimeConfigSource
} {
  return resolvePositiveIntegerSetting(
    env.DCLAW_LLM_MAX_RETRIES,
    'DCLAW_LLM_MAX_RETRIES',
    DEFAULT_LLM_MAX_RETRIES,
    getEnvSource,
  )
}

export function getLlmMaxRetries(
  env: NodeJS.ProcessEnv,
): number {
  return resolveLlmMaxRetries(env).value
}

export function getLlmRequestTimeoutMs(
  env: NodeJS.ProcessEnv,
): number {
  return resolveLlmRequestTimeoutMs(env).value
}

export function resolveLlmRequestTimeoutMs(
  env: NodeJS.ProcessEnv,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): {
  value: number
  source: RuntimeConfigSource
} {
  return resolvePositiveIntegerSetting(
    env.DCLAW_LLM_TIMEOUT_MS,
    'DCLAW_LLM_TIMEOUT_MS',
    DEFAULT_LLM_TIMEOUT_MS,
    getEnvSource,
  )
}

export function isStreamWatchdogEnabled(
  env: NodeJS.ProcessEnv,
): boolean {
  return resolveStreamWatchdogEnabled(env).value
}

export function resolveStreamWatchdogEnabled(
  env: NodeJS.ProcessEnv,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): {
  value: boolean
  source: RuntimeConfigSource
} {
  return resolveBooleanFlagSetting(
    env.DCLAW_ENABLE_STREAM_WATCHDOG,
    'DCLAW_ENABLE_STREAM_WATCHDOG',
    true,
    getEnvSource,
  )
}

export function getStreamIdleTimeoutMs(
  env: NodeJS.ProcessEnv,
): number {
  return resolveStreamIdleTimeoutMs(env).value
}

export function resolveStreamIdleTimeoutMs(
  env: NodeJS.ProcessEnv,
  getEnvSource?: (
    key: string,
  ) => Exclude<RuntimeConfigSource, 'env' | 'default'> | undefined,
): {
  value: number
  source: RuntimeConfigSource
} {
  return resolvePositiveIntegerSetting(
    env.DCLAW_STREAM_IDLE_TIMEOUT_MS,
    'DCLAW_STREAM_IDLE_TIMEOUT_MS',
    DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    getEnvSource,
  )
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: {
    timeoutMs: number
    timeoutMessage: string
    signal?: AbortSignal
  },
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromExternalSignal = (): void => {
    controller.abort()
  }
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  if (options.signal?.aborted) {
    controller.abort()
  } else {
    options.signal?.addEventListener('abort', abortFromExternalSignal, {
      once: true,
    })
  }

  try {
    return await operation(controller.signal)
  } catch (error) {
    if (
      timedOut &&
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new ProviderTimeoutError(options.timeoutMessage, options.timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abortFromExternalSignal)
  }
}

export function getRetryAfterMs(
  headers: Headers | undefined,
  now = Date.now(),
): number | null {
  const retryAfter = headers?.get('retry-after')
  if (!retryAfter) {
    return null
  }

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000))
  }

  const dateMs = Date.parse(retryAfter)
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - now)
  }

  return null
}

export function getAnthropicRateLimitResetDelayMs(
  headers: Headers | undefined,
  now = Date.now(),
): number | null {
  const resetHeader = headers?.get('anthropic-ratelimit-unified-reset')
  if (!resetHeader) {
    return null
  }

  const resetSeconds = Number(resetHeader)
  if (!Number.isFinite(resetSeconds)) {
    return null
  }

  return Math.max(0, resetSeconds * 1000 - now)
}

export function getRetryDelayMs(
  attempt: number,
  retryAfterMs: number | null,
  maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
): number {
  if (retryAfterMs !== null) {
    return retryAfterMs
  }

  const baseDelay = Math.min(
    DEFAULT_RETRY_INITIAL_DELAY_MS * Math.pow(2, attempt - 1),
    maxDelayMs,
  )
  const jitter = Math.random() * DEFAULT_RETRY_JITTER_RATIO * baseDelay
  return Math.round(baseDelay + jitter)
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status === 529 ||
    status >= 500
  )
}

function getShouldRetryDirective(
  headers: Headers | undefined,
): boolean | undefined {
  const header = headers?.get('x-should-retry')
  if (header === 'true') {
    return true
  }
  if (header === 'false') {
    return false
  }
  return undefined
}

function normalizeErrorToken(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some(needle => text.includes(needle))
}

function formatProviderName(providerName: string): string {
  if (providerName.toLowerCase() === 'openai') {
    return 'OpenAI'
  }
  if (providerName.toLowerCase() === 'anthropic') {
    return 'Anthropic'
  }
  return providerName
}

function buildUserMessage(
  providerName: string,
  kind: ProviderErrorKind,
  subtype: ProviderErrorSubtype,
): string {
  const providerLabel = formatProviderName(providerName)

  switch (subtype) {
    case 'invalid_api_key':
      return `${providerLabel} rejected the configured API key. Check the credential and any account or project access settings.`
    case 'token_revoked':
      return `${providerLabel} authentication was revoked. Re-authenticate or replace the credential before retrying.`
    case 'auth_error':
      return `${providerLabel} authentication failed. Check credentials and account access settings.`
    case 'insufficient_quota':
      return `${providerLabel} quota is exhausted. Check billing, credits, or organization limits before retrying.`
    case 'rate_limited':
      return `${providerLabel} rate limited this request. Wait and retry, or reduce request concurrency.`
    case 'server_overload':
      return `${providerLabel} is overloaded right now. Retry shortly or switch models/providers if available.`
    case 'model_not_found':
      return `The selected model is not available on ${providerLabel}. Check the model name and account access.`
    case 'invalid_model':
      return `The model setting sent to ${providerLabel} is invalid. Check llm.runtimes.<name>.primary.model and the provider's supported model list.`
    case 'prompt_too_long':
      return `The request sent to ${providerLabel} is too large. Reduce prompt or tool output size, or compact context before retrying.`
    case 'tool_use_mismatch':
      return `${providerLabel} rejected the tool call/result sequence. Ensure each tool_result matches a prior tool_use and appears in the expected order.`
    case 'request_too_large':
      return `The payload sent to ${providerLabel} is too large. Send less content or smaller files and try again.`
    case 'bad_request':
      return `${providerLabel} rejected the request as invalid. Check model, tool payloads, and request parameters.`
    case 'server_error':
      return `${providerLabel} returned a server error. Retry shortly; if it persists, try a different model or provider.`
    case 'network_error':
      return 'Network error while contacting the provider. Check your internet connection, proxy, base URL, or firewall settings and try again.'
    case 'unknown':
      break
  }

  switch (kind) {
    case 'auth':
      return `${providerLabel} authentication failed. Check credentials and account access settings.`
    case 'rate_limit':
      return `${providerLabel} rejected the request due to limits. Wait and retry, or review quota and billing settings.`
    case 'overloaded':
      return `${providerLabel} is overloaded right now. Retry shortly or switch models/providers if available.`
    case 'bad_request':
      return `${providerLabel} rejected the request as invalid. Check model, tool payloads, and request parameters.`
    case 'server_error':
      return `${providerLabel} returned a server error. Retry shortly; if it persists, try a different model or provider.`
    case 'network':
      return 'Network error while contacting the provider. Check your internet connection, proxy, base URL, or firewall settings and try again.'
    case 'unknown':
      return `The provider request failed. Inspect the error details and retry after correcting the request or configuration.`
  }
}

function classifyProviderHttpError(input: {
  providerName: string
  status: number
  message: string
  errorType?: string
  errorCode?: string
}): ProviderErrorClassification {
  const typeToken = normalizeErrorToken(input.errorType)
  const codeToken = normalizeErrorToken(input.errorCode)
  const messageToken = normalizeErrorToken(input.message)
  const combined = [typeToken, codeToken, messageToken]
    .filter(Boolean)
    .join(' ')

  let kind: ProviderErrorKind = 'unknown'
  let subtype: ProviderErrorSubtype = 'unknown'

  if (
    includesAny(combined, [
      'oauth_token_has_been_revoked',
      'token_revoked',
      'token_has_been_revoked',
    ])
  ) {
    kind = 'auth'
    subtype = 'token_revoked'
  } else if (
    includesAny(combined, [
      'invalid_api_key',
      'invalid_x_api_key',
      'incorrect_api_key',
      'api_key_invalid',
      'invalid_authentication_credentials',
      'x_api_key',
    ])
  ) {
    kind = 'auth'
    subtype = 'invalid_api_key'
  } else if (
    includesAny(combined, ['insufficient_quota', 'billing_hard_limit_reached']) ||
    (input.status === 429 &&
      includesAny(combined, ['quota', 'billing', 'credit balance is too low']))
  ) {
    kind = 'rate_limit'
    subtype = 'insufficient_quota'
  } else if (
    includesAny(combined, ['overloaded', 'overloaded_error', 'capacity']) ||
    input.status === 529
  ) {
    kind = 'overloaded'
    subtype = 'server_overload'
  } else if (
    includesAny(combined, [
      'prompt_is_too_long',
      'context_length_exceeded',
      'maximum_context_length',
      'too_many_tokens',
      'maximum_tokens',
    ]) ||
    /prompt is too long/i.test(input.message)
  ) {
    kind = 'bad_request'
    subtype = 'prompt_too_long'
  } else if (
    includesAny(combined, [
      'tool_use_ids_were_found_without_tool_result',
      'unexpected_tool_use_id',
      'tool_use_ids_must_be_unique',
    ]) ||
    input.message.includes('`tool_use` ids were found without `tool_result`') ||
    input.message.includes('unexpected `tool_use_id` found in `tool_result`') ||
    input.message.includes('`tool_use` ids must be unique')
  ) {
    kind = 'bad_request'
    subtype = 'tool_use_mismatch'
  } else if (
    includesAny(combined, ['request_too_large', 'payload_too_large']) ||
    input.status === 413
  ) {
    kind = 'bad_request'
    subtype = 'request_too_large'
  } else if (
    input.status === 404 &&
    (combined.includes('model') || combined.includes('not_found'))
  ) {
    kind = 'bad_request'
    subtype = 'model_not_found'
  } else if (
    includesAny(combined, [
      'invalid_model',
      'model_not_found',
      'unknown_model',
      'model_does_not_exist',
      'invalid_request_error',
    ]) &&
    combined.includes('model')
  ) {
    kind = 'bad_request'
    subtype = 'invalid_model'
  } else if (
    includesAny(combined, ['authentication', 'auth']) ||
    input.status === 401 ||
    input.status === 403
  ) {
    kind = 'auth'
    subtype = 'auth_error'
  } else if (
    includesAny(combined, ['rate_limit']) ||
    input.status === 429
  ) {
    kind = 'rate_limit'
    subtype = 'rate_limited'
  } else if (input.status >= 500) {
    kind = 'server_error'
    subtype = 'server_error'
  } else if (input.status >= 400) {
    kind = 'bad_request'
    subtype = 'bad_request'
  }

  return {
    kind,
    subtype,
    userMessage: buildUserMessage(input.providerName, kind, subtype),
  }
}

function unwrapRetryControlError(error: unknown): unknown {
  if (error instanceof NonRetryableError) {
    return error.causeValue
  }
  return error
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof NonRetryableError) {
    return false
  }

  if (error instanceof RetryableHttpError) {
    const shouldRetry = getShouldRetryDirective(error.headers)
    if (shouldRetry !== undefined) {
      return shouldRetry
    }
    return isRetryableStatus(error.status)
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return false
  }

  return error instanceof TypeError
}

export function getProviderErrorKind(error: unknown): ProviderErrorKind {
  if (error instanceof RetryableHttpError) {
    return error.kind
  }

  if (error instanceof TypeError) {
    return 'network'
  }

  return 'unknown'
}

export function getProviderErrorSubtype(error: unknown): ProviderErrorSubtype {
  if (error instanceof RetryableHttpError) {
    return error.subtype
  }

  if (error instanceof TypeError) {
    return 'network_error'
  }

  return 'unknown'
}

export function getProviderErrorUserMessage(error: unknown): string | undefined {
  if (error instanceof RetryableHttpError) {
    return error.userMessage
  }

  if (error instanceof TypeError) {
    return buildUserMessage('provider', 'network', 'network_error')
  }

  return undefined
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    maxRetries: number
    sleepImpl?: SleepImpl
    getDelayMs?: (error: unknown, attempt: number) => number | null | undefined
  },
): Promise<T> {
  const sleepImpl = options.sleepImpl ?? sleep
  let lastError: unknown

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt++) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt > options.maxRetries || !isRetryableError(error)) {
        throw unwrapRetryControlError(error)
      }

      const delayMs =
        options.getDelayMs?.(error, attempt) ??
        getRetryDelayMs(
          attempt,
          error instanceof RetryableHttpError
            ? getRetryAfterMs(error.headers)
            : null,
        )

      await sleepImpl(delayMs)
    }
  }

  throw unwrapRetryControlError(lastError)
}

export async function readSseEvents(
  response: Response,
  onEvent: (event: SseEvent) => void,
  options: ReadSseEventsOptions = {},
): Promise<void> {
  if (!response.body) {
    throw new Error('Streaming response body is not available')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const idleTimeoutMs = options.idleTimeoutMs
  const idleTimeoutError =
    idleTimeoutMs === undefined
      ? undefined
      : new ProviderTimeoutError(
          `Provider stream timed out after ${idleTimeoutMs}ms without receiving data`,
          idleTimeoutMs,
        )
  let idleTimedOut = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const parser = createParser({
    onEvent(event) {
      onEvent({
        event: event.event,
        data: event.data,
      })
    },
  })

  function clearIdleTimer(): void {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  function armIdleTimer(): void {
    clearIdleTimer()
    if (idleTimeoutMs === undefined) {
      return
    }

    idleTimer = setTimeout(() => {
      idleTimedOut = true
      void reader.cancel(idleTimeoutError).catch(() => {})
    }, idleTimeoutMs)
  }

  try {
    while (true) {
      armIdleTimer()
      let result: Awaited<ReturnType<typeof reader.read>>
      try {
        result = await reader.read()
      } catch (error) {
        if (idleTimedOut && idleTimeoutError) {
          throw idleTimeoutError
        }
        throw error
      } finally {
        clearIdleTimer()
      }

      if (idleTimedOut && idleTimeoutError) {
        throw idleTimeoutError
      }

      if (result.done) {
        break
      }

      options.onChunk?.(result.value)
      parser.feed(decoder.decode(result.value, { stream: true }))
    }

    parser.feed(decoder.decode())
  } finally {
    clearIdleTimer()
  }
}
