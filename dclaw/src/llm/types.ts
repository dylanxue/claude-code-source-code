import type { Message } from '../types/message.js'

export type LlmToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type CreateMessageRequest = {
  model?: string
  systemPrompt?: string
  messages: Message[]
  tools?: LlmToolDefinition[]
}

export type CreateMessageResponse = {
  message: Message
}

export type CreateMessageStreamCallbacks = {
  onTextDelta?: (text: string) => void
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
