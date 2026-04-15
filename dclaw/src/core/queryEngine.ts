import type { LlmClient } from '../llm/types.js'
import type { ToolContext } from '../types/tool.js'
import {
  createTextMessage,
  type Message,
} from '../types/message.js'
import type { ToolRegistry } from '../tools/registry.js'
import { executeSingleTurn } from './queryLoop.js'

export type QueryEngineOptions = {
  client: LlmClient
  model?: string
  systemPrompt?: string
  toolRegistry: ToolRegistry
  toolContext: ToolContext
  maxIterations?: number
}

export type QueryResult = {
  userMessage: Message
  assistantMessage: Message
  messages: Message[]
  outputText: string
}

export class QueryEngine {
  private readonly client: LlmClient
  private readonly model?: string
  private readonly systemPrompt?: string
  private readonly toolRegistry: ToolRegistry
  private readonly toolContext: ToolContext
  private readonly maxIterations: number
  private readonly messages: Message[]

  constructor(options: QueryEngineOptions) {
    this.client = options.client
    this.model = options.model
    this.systemPrompt = options.systemPrompt
    this.toolRegistry = options.toolRegistry
    this.toolContext = options.toolContext
    this.maxIterations = options.maxIterations ?? 4
    this.messages = []
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  async submitUserPrompt(prompt: string): Promise<QueryResult> {
    const userMessage = createTextMessage('user', prompt)
    this.messages.push(userMessage)

    const response = await executeSingleTurn({
      client: this.client,
      model: this.model,
      systemPrompt: this.systemPrompt,
      messages: this.getMessages(),
      toolRegistry: this.toolRegistry,
      toolContext: this.toolContext,
      maxIterations: this.maxIterations,
    })

    this.messages.push(...response.addedMessages)

    return {
      userMessage,
      assistantMessage: response.assistantMessage,
      messages: this.getMessages(),
      outputText: response.outputText,
    }
  }
}
