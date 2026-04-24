import type { ProviderErrorKind, ProviderErrorSubtype } from '../llm/providerUtils.js'
import type { Message } from '../types/message.js'

export type QueryLoopLlmErrorContext = {
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

export class QueryLoopLlmError extends Error {
  readonly causeValue: unknown
  readonly llmError: QueryLoopLlmErrorContext
  readonly addedMessages: Message[]
  readonly usedPostCompactAttachments: boolean

  constructor(
    causeValue: unknown,
    llmError: QueryLoopLlmErrorContext,
    options: {
      addedMessages?: Message[]
      usedPostCompactAttachments?: boolean
    } = {},
  ) {
    super(causeValue instanceof Error ? causeValue.message : llmError.message)
    this.name = 'QueryLoopLlmError'
    this.causeValue = causeValue
    this.llmError = llmError
    this.addedMessages = [...(options.addedMessages ?? [])]
    this.usedPostCompactAttachments =
      options.usedPostCompactAttachments === true
  }
}

export class QueryLoopAbortError extends Error {
  readonly addedMessages: Message[]
  readonly usedPostCompactAttachments: boolean

  constructor(
    options: {
      addedMessages?: Message[]
      usedPostCompactAttachments?: boolean
      message?: string
    } = {},
  ) {
    super(options.message ?? 'Query interrupted by user')
    this.name = 'QueryLoopAbortError'
    this.addedMessages = [...(options.addedMessages ?? [])]
    this.usedPostCompactAttachments =
      options.usedPostCompactAttachments === true
  }
}
