import type { Message } from '../types/message.js'

export type CreateMessageRequest = {
  model?: string
  systemPrompt?: string
  messages: Message[]
}

export type CreateMessageResponse = {
  message: Message
}

export interface LlmClient {
  readonly providerName: string
  createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse>
}

