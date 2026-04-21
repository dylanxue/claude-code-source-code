import { compactSession } from '../compact/compactSession.js'
import {
  getMessagesAfterCompactBoundary,
} from '../compact/boundaryMessage.js'
import {
  evaluateCompactPressure,
  type CompactRecommendation,
} from '../compact/pressure.js'
import {
  computeContextStats,
  type ContextStats,
} from './contextStats.js'
import { resolveModelLimits } from '../llm/modelLimits.js'
import type { LlmProviderName } from '../llm/providerNames.js'
import type { LlmClient } from '../llm/types.js'
import {
  deriveToolResultBudgetFromModelLimits,
} from './toolResultBudget.js'
import { type SessionMode } from '../session/store.js'
import type { PermissionMode, ToolContext } from '../types/tool.js'
import {
  createTextMessage,
  getModelVisibleMessages,
  type Message,
} from '../types/message.js'
import { loadTaskBoardForSession } from '../tasks/store.js'
import type { ToolRegistry } from '../tools/registry.js'
import {
  DEFAULT_QUERY_MAX_ITERATIONS,
  executeSingleTurn,
  type QueryLoopRequest,
} from './queryLoop.js'
import { QueryLoopLlmError } from './queryErrors.js'
import type { QueryTraceSink } from './queryTrace.js'
import {
  createPlanModeReminderMessages,
  createPostCompactPlanModeReminderMessage,
} from './planModeReminder.js'
import {
  createPostCompactAttachmentMessages,
  snapshotReadState,
  type PostCompactReadStateSnapshot,
} from './postCompactAttachments.js'
import { createToolResultAttachmentMessages } from './toolResultAttachments.js'
import { createTaskToolReminderMessage } from './taskToolReminder.js'
import type { ReadStateEntry } from '../types/tool.js'

export type QueryEngineOptions = {
  client: LlmClient
  provider?: LlmProviderName
  modelLimitsEnv?: NodeJS.ProcessEnv
  sessionMode?: SessionMode
  model?: string
  systemPrompt?: string
  systemPromptResolver?: (state: {
    sessionId?: string
    permissionMode: PermissionMode
    model?: string
    userPrompt: string
    queryTraceSink?: QueryTraceSink
  }) => Promise<string | undefined>
  turnCompleteHook?: (state: {
    sessionId?: string
    permissionMode: PermissionMode
    model?: string
    userPrompt: string
    assistantMessage: Message
    outputText: string
    messages: Message[]
    queryTraceSink?: QueryTraceSink
  }) => Promise<Message[] | void>
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
  appendedMessages: Message[]
  outputText: string
  sessionId?: string
  autoCompact?: {
    sessionId: string
    boundaryId: string
    reason: string
    summaryMessageId: string
  }
}

export type QueryStreamHandlers = NonNullable<QueryLoopRequest['streamHandlers']>

export class QueryEngine {
  private readonly client: LlmClient
  private readonly provider?: LlmProviderName
  private readonly modelLimitsEnv?: NodeJS.ProcessEnv
  private readonly sessionMode: SessionMode
  private model?: string
  private systemPrompt?: string
  private readonly systemPromptResolver?: QueryEngineOptions['systemPromptResolver']
  private readonly turnCompleteHook?: QueryEngineOptions['turnCompleteHook']
  private readonly toolRegistry: ToolRegistry
  private readonly toolContext: ToolContext
  private readonly maxIterations: number
  private readonly messages: Message[]
  private queryTraceSink?: QueryTraceSink
  private postCompactReadState?: {
    boundaryId: string
    entries: PostCompactReadStateSnapshot
  }

  constructor(options: QueryEngineOptions) {
    this.client = options.client
    this.provider = options.provider
    this.modelLimitsEnv = options.modelLimitsEnv
    this.sessionMode = options.sessionMode ?? 'interactive'
    this.model = options.model
    this.systemPrompt = options.systemPrompt
    this.systemPromptResolver = options.systemPromptResolver
    this.turnCompleteHook = options.turnCompleteHook
    this.toolRegistry = options.toolRegistry
    this.toolContext = options.toolContext
    this.toolContext.setPermissionMode ??= (
      permissionMode: PermissionMode,
    ) => {
      this.toolContext.permissionMode = permissionMode
    }
    this.toolContext.setPlanFilePath ??= (
      planFilePath: string | undefined,
    ) => {
      this.toolContext.planFilePath = planFilePath
    }
    this.maxIterations = options.maxIterations ?? DEFAULT_QUERY_MAX_ITERATIONS
    this.messages = [...(options.initialMessages ?? [])]
    this.queryTraceSink = options.queryTraceSink
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  appendMessages(messages: Message[]): void {
    if (messages.length === 0) {
      return
    }
    this.messages.push(...messages)
  }

  resetMessages(messages: Message[] = []): void {
    this.messages.splice(0, this.messages.length, ...messages)
    this.toolContext.readState.clear()
  }

  setModel(model: string | undefined): void {
    this.model = model
  }

  setSystemPrompt(systemPrompt: string | undefined): void {
    this.systemPrompt = systemPrompt
  }

  setPermissionMode(permissionMode: PermissionMode): void {
    this.toolContext.permissionMode = permissionMode
  }

  setPlanFilePath(planFilePath: string | undefined): void {
    this.toolContext.planFilePath = planFilePath
  }

  setSessionId(sessionId: string | undefined): void {
    this.toolContext.sessionId = sessionId
  }

  setQueryTraceSink(queryTraceSink: QueryTraceSink | undefined): void {
    this.queryTraceSink = queryTraceSink
  }

  getSessionId(): string | undefined {
    return this.toolContext.sessionId
  }

  getQueryTracePath(): string | undefined {
    return this.queryTraceSink?.filePath
  }

  getPermissionMode(): PermissionMode {
    return this.toolContext.permissionMode
  }

  getPlanFilePath(): string | undefined {
    return this.toolContext.planFilePath
  }

  preparePostCompactRecovery(boundaryId: string): void {
    this.postCompactReadState = {
      boundaryId,
      entries: snapshotReadState(
        this.toolContext.readState as Map<string, ReadStateEntry>,
      ),
    }
    this.toolContext.readState.clear()
  }

  private async getResolvedSystemPrompt(
    userPrompt: string,
  ): Promise<string | undefined> {
    if (!this.systemPromptResolver) {
      return this.systemPrompt
    }

    return this.systemPromptResolver({
      sessionId: this.toolContext.sessionId,
      permissionMode: this.toolContext.permissionMode,
      model: this.model,
      userPrompt,
      queryTraceSink: this.queryTraceSink,
    })
  }

  private async getTransientContextMessages(
    baseMessages: Message[] = this.getMessages(),
  ): Promise<{
    messages: Message[]
    usedPostCompactAttachments: boolean
  }> {
    const visibleMessages = getMessagesAfterCompactBoundary(baseMessages)
    const transientMessages: Message[] = createToolResultAttachmentMessages(
      visibleMessages,
    )

    if (!this.toolContext.sessionId) {
      return {
        messages: transientMessages,
        usedPostCompactAttachments: false,
      }
    }

    const board = await loadTaskBoardForSession(
      this.toolContext.sessionId,
      this.modelLimitsEnv,
    )
    const allMessages = baseMessages
    const messages = visibleMessages
    const recoveryReadState = this.postCompactReadState?.entries
    const postCompactAttachments = await createPostCompactAttachmentMessages(
      allMessages,
      board,
      recoveryReadState,
      this.toolContext.availableTools,
    )
    transientMessages.push(...postCompactAttachments)

    const postCompactPlanModeReminder = createPostCompactPlanModeReminderMessage(
      allMessages,
      board,
      this.toolContext.permissionMode,
    )
    if (postCompactPlanModeReminder) {
      transientMessages.push(postCompactPlanModeReminder)
    } else {
      const planModeReminderMessages = await createPlanModeReminderMessages(
        messages,
        board,
        this.toolContext.permissionMode,
        this.modelLimitsEnv,
      )
      transientMessages.push(...planModeReminderMessages)
    }

    const taskReminderMessage = createTaskToolReminderMessage(
      messages,
      board,
      this.toolContext.availableTools,
    )
    if (taskReminderMessage) {
      transientMessages.push(taskReminderMessage)
    }

    return {
      messages: transientMessages,
      usedPostCompactAttachments: postCompactAttachments.length > 0,
    }
  }

  getContextStats(): ContextStats {
    const visibleMessages = getMessagesAfterCompactBoundary(
      getModelVisibleMessages(this.getMessages()),
    )
    const modelLimits =
      this.provider && this.provider !== 'stub'
        ? resolveModelLimits(this.provider, this.model, this.modelLimitsEnv)
        : undefined
    const toolResultBudgetOptions = modelLimits
      ? deriveToolResultBudgetFromModelLimits(modelLimits)
      : undefined

    return computeContextStats(visibleMessages, {
      modelLimits,
      toolResultBudgetOptions,
    })
  }

  getCompactRecommendation(): CompactRecommendation {
    return evaluateCompactPressure(this.getContextStats())
  }

  private getResolvedModelLimits() {
    return this.provider && this.provider !== 'stub'
      ? resolveModelLimits(this.provider, this.model, this.modelLimitsEnv)
      : undefined
  }

  private getResolvedToolResultBudgetOptions() {
    const modelLimits = this.getResolvedModelLimits()
    return modelLimits
      ? deriveToolResultBudgetFromModelLimits(modelLimits)
      : undefined
  }

  private async autoCompactIfNeeded(
    streamHandlers?: QueryStreamHandlers,
  ): Promise<QueryResult['autoCompact'] | undefined> {
    const sourceSessionId = this.toolContext.sessionId
    if (!sourceSessionId || !this.provider) {
      return undefined
    }

    const contextStats = this.getContextStats()
    const recommendation = evaluateCompactPressure(contextStats)
    if (
      !recommendation.shouldCompact ||
      recommendation.autoCompactThresholdTokens === undefined
    ) {
      return undefined
    }

    const reason =
      recommendation.reasons[0] ??
      `estimated token usage reached the auto-compact threshold (${recommendation.tokenUsage}/${recommendation.autoCompactThresholdTokens})`

    this.queryTraceSink?.record({
      event: 'compact.auto.start',
      data: {
        sourceSessionId,
        reason,
        contextStats,
        compactRecommendation: recommendation,
      },
    })

    try {
      const { boundary, boundaryMessage, summaryMessage } = await compactSession({
        sourceSessionId,
        messages: getMessagesAfterCompactBoundary(
          getModelVisibleMessages(this.getMessages()),
        ),
        cwd: this.toolContext.cwd,
        provider: this.provider,
        model: this.model,
        trigger: 'auto',
        reason,
        contextStats,
        client: this.client,
        env: this.modelLimitsEnv,
      })

      this.preparePostCompactRecovery(boundary.boundaryId)
      this.messages.push(boundaryMessage, summaryMessage)

      const event = {
        sessionId: sourceSessionId,
        boundaryId: boundary.boundaryId,
        reason,
        summaryMessageId: summaryMessage.id,
      }

      this.queryTraceSink?.record({
        event: 'compact.auto.success',
        data: event,
      })
      streamHandlers?.onAutoCompact?.(event)
      return event
    } catch (error) {
      this.queryTraceSink?.record({
        event: 'compact.auto.failure',
        data: {
          sourceSessionId,
          reason,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) },
        },
      })
      return undefined
    }
  }

  async submitUserPrompt(prompt: string): Promise<QueryResult> {
    return this.submitUserPromptWithHandlers(prompt)
  }

  async submitUserPromptWithHandlers(
    prompt: string,
    streamHandlers?: QueryStreamHandlers,
  ): Promise<QueryResult> {
    const autoCompact = await this.autoCompactIfNeeded(streamHandlers)
    const persistedMessagesBeforeUser = this.getMessages()
    const priorMessages = getMessagesAfterCompactBoundary(
      getModelVisibleMessages(persistedMessagesBeforeUser),
    )
    const userMessage = createTextMessage('user', prompt)
    this.messages.push(userMessage)
    const baseTurnMessages = [...priorMessages, userMessage]
    const persistedMessagesWithUser = this.getMessages()
    const modelLimits = this.getResolvedModelLimits()
    const toolResultBudgetOptions = this.getResolvedToolResultBudgetOptions()

    let response
    try {
      response = await executeSingleTurn({
        client: this.client,
        modelLimits,
        model: this.model,
        messages: baseTurnMessages,
        resolveIterationRequest: async workingMessages => {
          const currentTurnMessages = workingMessages.slice(baseTurnMessages.length)
          const [systemPrompt, transientContext] = await Promise.all([
            this.getResolvedSystemPrompt(prompt),
            this.getTransientContextMessages(
              currentTurnMessages.length === 0
                ? persistedMessagesBeforeUser
                : [...persistedMessagesWithUser, ...currentTurnMessages],
            ),
          ])

          return {
            systemPrompt,
            messages: [...workingMessages, ...transientContext.messages],
            usedPostCompactAttachments: transientContext.usedPostCompactAttachments,
          }
        },
        toolRegistry: this.toolRegistry,
        toolContext: this.toolContext,
        maxIterations: this.maxIterations,
        toolResultBudgetOptions,
        streamHandlers,
        queryTraceSink: this.queryTraceSink,
      })
    } catch (error) {
      if (error instanceof QueryLoopLlmError) {
        if (error.addedMessages.length > 0) {
          this.messages.push(...error.addedMessages)
        }
        if (error.usedPostCompactAttachments) {
          this.postCompactReadState = undefined
        }
      }
      throw error
    }

    this.messages.push(...response.addedMessages)
    if (response.usedPostCompactAttachments) {
      this.postCompactReadState = undefined
    }
    const hookMessages: Message[] = []
    if (this.turnCompleteHook) {
      try {
        const produced =
          await this.turnCompleteHook({
            sessionId: this.toolContext.sessionId,
            permissionMode: this.toolContext.permissionMode,
            model: this.model,
            userPrompt: prompt,
            assistantMessage: response.assistantMessage,
            outputText: response.outputText,
            messages: this.getMessages(),
            queryTraceSink: this.queryTraceSink,
          }) ?? []
        if (produced.length > 0) {
          this.messages.push(...produced)
          hookMessages.push(...produced)
        }
      } catch {
        // Post-turn hooks are best-effort and should not fail the main turn.
      }
    }

    return {
      userMessage,
      assistantMessage: response.assistantMessage,
      messages: this.getMessages(),
      appendedMessages: [userMessage, ...response.addedMessages, ...hookMessages],
      outputText: response.outputText,
      sessionId: this.getSessionId(),
      ...(autoCompact ? { autoCompact } : {}),
    }
  }
}
