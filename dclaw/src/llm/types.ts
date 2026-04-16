import type { Message } from '../types/message.js'

export type LlmToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type OpenAiTextVerbosity = 'low' | 'medium' | 'high'

export type OpenAiReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'

export type OpenAiResponsesRequestOptions = {
  verbosity?: OpenAiTextVerbosity
  reasoningEffort?: OpenAiReasoningEffort
  previousResponseId?: string
  store?: boolean
  parallelToolCalls?: boolean
  maxToolCalls?: number
  include?: string[]
  truncation?: 'auto' | 'disabled'
  metadata?: Record<string, string>
  textFormat?: Record<string, unknown>
}

export type CreateMessageRequest = {
  model?: string
  systemPrompt?: string
  messages: Message[]
  tools?: LlmToolDefinition[]
  providerOptions?: {
    openai?: OpenAiResponsesRequestOptions
  }
}

export type CreateMessageResponse = {
  message: Message
}

export type CreateMessageStreamCallbacks = {
  onTextDelta?: (text: string) => void
  onReasoningDelta?: (delta: {
    kind: 'reasoning' | 'thinking'
    text: string
  }) => void
}

export interface LlmClient {
  readonly providerName: string
  createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse>
  createMessageStream?(
    request: CreateMessageRequest,
    callbacks: CreateMessageStreamCallbacks,
  ): Promise<CreateMessageResponse>
}
