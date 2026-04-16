import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCliErrorInfo,
  getCliErrorOutput,
} from '../../src/cli/errorFormatting.js'
import { QueryLoopLlmError } from '../../src/core/queryErrors.js'
import { RetryableHttpError } from '../../src/llm/providerUtils.js'

test('getCliErrorInfo formats provider rate-limit errors with structured metadata', () => {
  const error = new RetryableHttpError(
    'OpenAI',
    429,
    'Too Many Requests',
    {
      message: 'rate limit exceeded',
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    },
    new Headers({
      'x-should-retry': 'true',
    }),
  )

  const info = getCliErrorInfo(error)

  assert.equal(
    info.formattedText,
    'CLI failed [openai/rate_limit/rate_limited]: OpenAI request failed (429 Too Many Requests): rate limit exceeded\n' +
      'Hint: OpenAI rate limited this request. Wait and retry, or reduce request concurrency.',
  )
  assert.deepEqual(info.ssePayload, {
    message: 'OpenAI request failed (429 Too Many Requests): rate limit exceeded',
    kind: 'rate_limit',
    subtype: 'rate_limited',
    userMessage:
      'OpenAI rate limited this request. Wait and retry, or reduce request concurrency.',
    provider: 'openai',
    status: 429,
    statusText: 'Too Many Requests',
    errorType: 'rate_limit_error',
    errorCode: 'rate_limit_exceeded',
    retryable: true,
    retryDirective: true,
  })
})

test('getCliErrorInfo formats network failures for CLI and SSE output', () => {
  const info = getCliErrorInfo(new TypeError('fetch failed'))

  assert.equal(
    info.formattedText,
    'CLI failed [network/network_error]: fetch failed\n' +
      'Hint: Network error while contacting the provider. Check your internet connection, proxy, base URL, or firewall settings and try again.',
  )
  assert.deepEqual(info.ssePayload, {
    message: 'fetch failed',
    kind: 'network',
    subtype: 'network_error',
    userMessage:
      'Network error while contacting the provider. Check your internet connection, proxy, base URL, or firewall settings and try again.',
    retryable: true,
  })
})

test('getCliErrorInfo preserves partial stream context for wrapped llm failures', () => {
  const info = getCliErrorInfo(
    new QueryLoopLlmError(new TypeError('terminated'), {
      iteration: 2,
      streaming: true,
      phase: 'during_stream',
      kind: 'network',
      subtype: 'network_error',
      errorName: 'TypeError',
      message: 'terminated',
      streamedTextChars: 0,
      streamedReasoningChars: 42,
      lastReasoningDelta: {
        kind: 'thinking',
        text: 'Need to inspect first.',
      },
    }),
  )

  assert.match(
    info.formattedText,
    /Context: phase=during_stream iteration=2 streamed_reasoning_chars=42/,
  )
  assert.deepEqual(info.ssePayload.llmError, {
    iteration: 2,
    streaming: true,
    phase: 'during_stream',
    kind: 'network',
    subtype: 'network_error',
    errorName: 'TypeError',
    message: 'terminated',
    streamedTextChars: 0,
    streamedReasoningChars: 42,
    lastReasoningDelta: {
      kind: 'thinking',
      text: 'Need to inspect first.',
    },
  })
})

test('getCliErrorOutput emits response.error SSE events for print+sse mode', () => {
  const error = new RetryableHttpError(
    'Anthropic',
    429,
    'Too Many Requests',
    {
      message: 'rate limit reached',
      type: 'rate_limit_error',
    },
    new Headers(),
  )

  const output = getCliErrorOutput(
    {
      mode: 'print',
      prompt: 'hello',
      options: {
        cwd: '/tmp',
        permissionMode: 'default',
        stream: true,
        verbose: false,
        outputFormat: 'sse',
      },
    },
    error,
  )

  assert.equal(output.stream, 'stdout')
  assert.match(output.text, /^event: response\.error\n/)
  assert.match(output.text, /"kind":"rate_limit"/)
  assert.match(output.text, /"subtype":"rate_limited"/)
  assert.match(output.text, /"provider":"anthropic"/)
})

test('getCliErrorOutput emits stderr text for non-sse commands', () => {
  const output = getCliErrorOutput(
    {
      mode: 'interactive',
      prompt: 'hello',
      options: {
        cwd: '/tmp',
        permissionMode: 'default',
        stream: false,
        verbose: false,
        outputFormat: 'text',
      },
    },
    new TypeError('fetch failed'),
  )

  assert.equal(output.stream, 'stderr')
  assert.equal(
    output.text,
    'CLI failed [network/network_error]: fetch failed\n' +
      'Hint: Network error while contacting the provider. Check your internet connection, proxy, base URL, or firewall settings and try again.\n',
  )
})

test('getCliErrorInfo surfaces specific subtype hints like insufficient_quota', () => {
  const error = new RetryableHttpError(
    'OpenAI',
    429,
    'Too Many Requests',
    {
      message: 'You exceeded your current quota.',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    },
    new Headers(),
  )

  const info = getCliErrorInfo(error)

  assert.equal(info.ssePayload.subtype, 'insufficient_quota')
  assert.equal(
    info.ssePayload.userMessage,
    'OpenAI quota is exhausted. Check billing, credits, or organization limits before retrying.',
  )
  assert.match(info.formattedText, /Hint: OpenAI quota is exhausted\./)
})
