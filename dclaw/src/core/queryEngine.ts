import { resolveModelLimits } from '../llm/modelLimits.js'
import type { LlmProviderName } from '../llm/providerNames.js'
import type { LlmClient } from '../llm/types.js'
import {
  deriveToolResultBudgetFromModelLimits,
} from './toolResultBudget.js'
import type { PermissionMode, ToolContext } from '../types/tool.js'
import {
  createTextMessage,
  type Message,
} from '../types/message.js'
import type { ToolRegistry } from '../tools/registry.js'
import { executeSingleTurn, type QueryLoopRequest } from './queryLoop.js'
import type { QueryTraceSink } from './queryTrace.js'

export type QueryEngineOptions = {
  client: LlmClient
  provider?: LlmProviderName
  modelLimitsEnv?: NodeJS.ProcessEnv
  model?: string
  systemPrompt?: string
  toolRegistry: ToolRegistry
  toolContext: ToolContext
  maxIterations?: number
  initialMessages?: Message[]
  queryTraceSink?: QueryTraceSink
}

export type QueryResult = {
  userMessage: Message
  assistantMessage: Message
  messages: Message[]
  outputText: string
}

export type QueryStreamHandlers = NonNullable<QueryLoopRequest['streamHandlers']>

export class QueryEngine {
  private readonly client: LlmClient
  private readonly provider?: LlmProviderName
  private readonly modelLimitsEnv?: NodeJS.ProcessEnv
  private model?: string
  private readonly systemPrompt?: string
  private readonly toolRegistry: ToolRegistry
  private readonly toolContext: ToolContext
  private readonly maxIterations: number
  private readonly messages: Message[]
  private readonly queryTraceSink?: QueryTraceSink

  constructor(options: QueryEngineOptions) {
    this.client = options.client
    this.provider = options.provider
    this.modelLimitsEnv = options.modelLimitsEnv
    this.model = options.model
    this.systemPrompt = options.systemPrompt
    this.toolRegistry = options.toolRegistry
    this.toolContext = options.toolContext
    this.maxIterations = options.maxIterations ?? 4
    this.messages = [...(options.initialMessages ?? [])]
    this.queryTraceSink = options.queryTraceSink
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  resetMessages(messages: Message[] = []): void {
    this.messages.splice(0, this.messages.length, ...messages)
    this.toolContext.readState.clear()
  }

  setModel(model: string | undefined): void {
    this.model = model
  }

  setPermissionMode(permissionMode: PermissionMode): void {
    this.toolContext.permissionMode = permissionMode
  }

  async submitUserPrompt(prompt: string): Promise<QueryResult> {
    return this.submitUserPromptWithHandlers(prompt)
  }

  async submitUserPromptWithHandlers(
    prompt: string,
    streamHandlers?: QueryStreamHandlers,
  ): Promise<QueryResult> {
    const userMessage = createTextMessage('user', prompt)
    this.messages.push(userMessage)
    const modelLimits =
      this.provider && this.provider !== 'stub'
        ? resolveModelLimits(this.provider, this.model, this.modelLimitsEnv)
        : undefined
    const toolResultBudgetOptions = modelLimits
      ? deriveToolResultBudgetFromModelLimits(modelLimits)
      : undefined

    const response = await executeSingleTurn({
      client: this.client,
      modelLimits,
      model: this.model,
      systemPrompt: this.systemPrompt,
      messages: this.getMessages(),
      toolRegistry: this.toolRegistry,
      toolContext: this.toolContext,
      maxIterations: this.maxIterations,
      toolResultBudgetOptions,
      streamHandlers,
      queryTraceSink: this.queryTraceSink,
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
