import {
  getProviderErrorKind,
  getProviderErrorSubtype,
  getProviderErrorUserMessage,
  RetryableHttpError,
  type ProviderErrorKind,
  type ProviderErrorSubtype,
} from '../llm/providerUtils.js'
import { QueryLoopLlmError } from '../core/queryErrors.js'
import type { ParsedCliCommand } from './types.js'

export type CliErrorInfo = {
  message: string
  formattedText: string
  ssePayload: {
    message: string
    kind: ProviderErrorKind
    subtype: ProviderErrorSubtype
    userMessage?: string
    provider?: string
    status?: number
    statusText?: string
    errorType?: string
    errorCode?: string
    retryable?: boolean
    retryDirective?: boolean
    llmError?: {
      iteration: number
      streaming: boolean
      phase: 'before_response' | 'during_stream'
      kind: ProviderErrorKind
      subtype: ProviderErrorSubtype
      errorName?: string
      message: string
      streamedTextChars: number
      streamedReasoningChars: number
      lastTextDelta?: string
      lastReasoningDelta?: {
        kind: 'reasoning' | 'thinking'
        text: string
      }
    }
  }
}

export type CliErrorOutput = {
  stream: 'stdout' | 'stderr'
  text: string
}

function getErrorWithContext(error: unknown): {
  source: unknown
  llmError:
    | QueryLoopLlmError['llmError']
    | undefined
} {
  if (error instanceof QueryLoopLlmError) {
    return {
      source: error.causeValue,
      llmError: error.llmError,
    }
  }

  return {
    source: error,
    llmError: undefined,
  }
}

function formatLlmErrorContext(
  llmError: QueryLoopLlmError['llmError'] | undefined,
): string {
  if (!llmError) {
    return ''
  }

  const parts = [
    `phase=${llmError.phase}`,
    `iteration=${llmError.iteration}`,
  ]
  if (llmError.streamedReasoningChars > 0) {
    parts.push(`streamed_reasoning_chars=${llmError.streamedReasoningChars}`)
  }
  if (llmError.streamedTextChars > 0) {
    parts.push(`streamed_text_chars=${llmError.streamedTextChars}`)
  }
  return `\nContext: ${parts.join(' ')}`
}

export function getCliErrorInfo(error: unknown): CliErrorInfo {
  const { source, llmError } = getErrorWithContext(error)

  if (source instanceof RetryableHttpError) {
    const provider = source.providerName.toLowerCase()
    const kind = source.kind
    const subtype = source.subtype
    const prefix = `CLI failed [${provider}/${kind}/${subtype}]`
    const hint =
      source.userMessage.length > 0 ? `\nHint: ${source.userMessage}` : ''
    const context = formatLlmErrorContext(llmError)

    return {
      message: source.message,
      formattedText: `${prefix}: ${source.message}${hint}${context}`,
      ssePayload: {
        message: source.message,
        kind,
        subtype,
        ...(source.userMessage.length > 0
          ? { userMessage: source.userMessage }
          : {}),
        provider,
        status: source.status,
        statusText: source.statusText,
        ...(source.errorType ? { errorType: source.errorType } : {}),
        ...(source.errorCode ? { errorCode: source.errorCode } : {}),
        retryable: true,
        ...(source.retryDirective === undefined
          ? {}
          : { retryDirective: source.retryDirective }),
        ...(llmError ? { llmError } : {}),
      },
    }
  }

  if (source instanceof TypeError) {
    const kind = getProviderErrorKind(source)
    const subtype = getProviderErrorSubtype(source)
    const userMessage = getProviderErrorUserMessage(source)
    const context = formatLlmErrorContext(llmError)
    return {
      message: source.message,
      formattedText:
        `CLI failed [${kind}/${subtype}]: ${source.message}` +
        (userMessage ? `\nHint: ${userMessage}` : '') +
        context,
      ssePayload: {
        message: source.message,
        kind,
        subtype,
        ...(userMessage ? { userMessage } : {}),
        retryable: true,
        ...(llmError ? { llmError } : {}),
      },
    }
  }

  const message =
    source instanceof Error ? source.message : 'Unknown CLI failure'
  const context = formatLlmErrorContext(llmError)
  return {
    message,
    formattedText: `CLI failed: ${message}${context}`,
    ssePayload: {
      message,
      kind: 'unknown',
      subtype: 'unknown',
      retryable: false,
      ...(llmError ? { llmError } : {}),
    },
  }
}

export function getCliErrorOutput(
  command: ParsedCliCommand | undefined,
  error: unknown,
): CliErrorOutput {
  const info = getCliErrorInfo(error)
  if (
    command?.mode === 'print' &&
    command.options.outputFormat === 'sse'
  ) {
    return {
      stream: 'stdout',
      text:
        'event: response.error\n' +
        `data: ${JSON.stringify(info.ssePayload)}\n\n`,
    }
  }

  return {
    stream: 'stderr',
    text: `${info.formattedText}\n`,
  }
}
