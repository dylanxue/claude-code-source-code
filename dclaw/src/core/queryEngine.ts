import { compactSession } from '../compact/compactSession.js'
import type { ModelCatalogOverrides } from '../llm/config.js'
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
  createDclawMdReminderMessage,
  type DclawMdEntry,
} from '../prompt/dclawMd.js'
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
import { QueryLoopAbortError, QueryLoopLlmError } from './queryErrors.js'
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
import {
  createInvokedSkillState,
  listInvokedSkills,
  replaceInvokedSkills,
  restoreInvokedSkillsFromMessages,
  type InvokedSkill,
} from '../skills/state.js'
import { getLastCompactBoundary, isFreshlyCompactedSession } from '../compact/boundaryMessage.js'
import {
  buildSkillListingReminderText,
  parseSkillListingReminderText,
} from '../skills/prompt.js'

export type QueryEngineOptions = {
  client: LlmClient
  provider?: LlmProviderName
  modelLimitsEnv?: NodeJS.ProcessEnv
  modelCatalogOverrides?: ModelCatalogOverrides
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
  dclawMdEntries?: DclawMdEntry[]
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

export type QuerySubmitOptions = {
  signal?: AbortSignal
}

export class QueryEngine {
  private readonly client: LlmClient
  private readonly provider?: LlmProviderName
  private readonly modelLimitsEnv?: NodeJS.ProcessEnv
  private readonly modelCatalogOverrides?: ModelCatalogOverrides
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
  private readonly dclawMdEntries: DclawMdEntry[]
  private postCompactReadState?: {
    boundaryId: string
    entries: PostCompactReadStateSnapshot
  }
  private postCompactInvokedSkills?: {
    boundaryId: string
    skills: InvokedSkill[]
  }
  private sentSkillNames = new Set<string>()
  private suppressNextSkillListing = false
  private postCompactSentSkillNames?: {
    boundaryId: string
    names: string[]
  }

  constructor(options: QueryEngineOptions) {
    this.client = options.client
    this.provider = options.provider
    this.modelLimitsEnv = options.modelLimitsEnv
    this.modelCatalogOverrides = options.modelCatalogOverrides
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
    this.toolContext.invokedSkills ??= createInvokedSkillState()
    if (this.messages.length > 0) {
      restoreInvokedSkillsFromMessages(
        this.messages,
        this.toolContext.invokedSkills,
      )
    }
    this.restoreSkillListingStateFromMessages(this.messages)
    this.queryTraceSink = options.queryTraceSink
    this.toolContext.queryTraceSink = this.queryTraceSink
    this.dclawMdEntries = [...(options.dclawMdEntries ?? [])]
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getClient(): LlmClient {
    return this.client
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
    const compactBoundary = getLastCompactBoundary(messages)
    if (
      compactBoundary &&
      isFreshlyCompactedSession(messages) &&
      this.postCompactInvokedSkills?.boundaryId === compactBoundary.boundaryId
    ) {
      replaceInvokedSkills(
        this.toolContext.invokedSkills,
        this.postCompactInvokedSkills.skills,
      )
      this.sentSkillNames = new Set(
        this.postCompactSentSkillNames?.boundaryId === compactBoundary.boundaryId
          ? this.postCompactSentSkillNames.names
          : [],
      )
      this.suppressNextSkillListing = false
      return
    }

    this.postCompactInvokedSkills = undefined
    this.postCompactSentSkillNames = undefined
    restoreInvokedSkillsFromMessages(messages, this.toolContext.invokedSkills)
    this.restoreSkillListingStateFromMessages(messages)
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
    this.toolContext.queryTraceSink = queryTraceSink
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
    this.postCompactInvokedSkills = {
      boundaryId,
      skills: listInvokedSkills(this.toolContext.invokedSkills),
    }
    this.postCompactSentSkillNames = {
      boundaryId,
      names: [...this.sentSkillNames],
    }
    this.toolContext.readState.clear()
  }

  private restoreSkillListingStateFromMessages(messages: Message[]): void {
    const sent = new Set<string>()
    let sawListing = false

    for (const message of messages) {
      const listing = parseSkillListingReminderText(
        message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
      )
      if (!listing) {
        continue
      }

      sawListing = true
      for (const skill of listing) {
        sent.add(skill.name)
      }
    }

    this.sentSkillNames = sent
    this.suppressNextSkillListing = sawListing
  }

  private createSkillListingMessages(): Message[] {
    if (
      !this.toolRegistry.list().some(tool => tool.name === 'Skill') ||
      !this.toolContext.availableTools.includes('Skill') ||
      !this.toolContext.skillRegistry
    ) {
      return []
    }

    const currentSkills = [...this.toolContext.skillRegistry.list()].sort((left, right) => {
      if (left.name === 'install-skills' && right.name !== 'install-skills') {
        return -1
      }
      if (right.name === 'install-skills' && left.name !== 'install-skills') {
        return 1
      }
      return left.name.localeCompare(right.name)
    })
    if (currentSkills.length === 0) {
      return []
    }

    if (this.suppressNextSkillListing) {
      this.suppressNextSkillListing = false
      currentSkills.forEach(skill => {
        this.sentSkillNames.add(skill.name)
      })
      return []
    }

    const newSkills = currentSkills.filter(
      skill => !this.sentSkillNames.has(skill.name),
    )
    if (newSkills.length === 0) {
      return []
    }

    newSkills.forEach(skill => {
      this.sentSkillNames.add(skill.name)
    })

    return [
      createTextMessage(
        'user',
        `<system-reminder>\n${buildSkillListingReminderText(newSkills)}\n</system-reminder>`,
      ),
    ]
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
    prompt: string,
    baseMessages: Message[] = this.getMessages(),
  ): Promise<{
    messages: Message[]
    usedPostCompactAttachments: boolean
  }> {
    const visibleMessages = getMessagesAfterCompactBoundary(baseMessages)
    const transientMessages: Message[] = createToolResultAttachmentMessages(
      visibleMessages,
    )
    const dclawMdReminder = createDclawMdReminderMessage(this.dclawMdEntries)
    if (dclawMdReminder) {
      transientMessages.push(dclawMdReminder)
    }

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
    const invokedSkills = listInvokedSkills(this.toolContext.invokedSkills)
    const postCompactAttachments = await createPostCompactAttachmentMessages(
      allMessages,
      board,
      recoveryReadState,
      invokedSkills,
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
        ? resolveModelLimits(this.provider, this.model, {
            env: this.modelLimitsEnv,
            overrides: this.modelCatalogOverrides,
          })
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
      ? resolveModelLimits(this.provider, this.model, {
          env: this.modelLimitsEnv,
          overrides: this.modelCatalogOverrides,
        })
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
    options: QuerySubmitOptions = {},
  ): Promise<QueryResult['autoCompact'] | undefined> {
    if (options.signal?.aborted) {
      throw new QueryLoopAbortError({
        usedPostCompactAttachments: false,
      })
    }

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

  async submitUserPrompt(
    prompt: string,
    options: QuerySubmitOptions = {},
  ): Promise<QueryResult> {
    return this.submitUserPromptWithHandlers(prompt, undefined, options)
  }

  async submitUserPromptWithHandlers(
    prompt: string,
    streamHandlers?: QueryStreamHandlers,
    options: QuerySubmitOptions = {},
  ): Promise<QueryResult> {
    const autoCompact = await this.autoCompactIfNeeded(streamHandlers, options)
    const persistedMessagesBeforeUser = this.getMessages()
    const priorMessages = getMessagesAfterCompactBoundary(
      getModelVisibleMessages(persistedMessagesBeforeUser),
    )
    const userMessage = createTextMessage('user', prompt)
    const skillListingMessages = this.createSkillListingMessages()
    this.messages.push(userMessage, ...skillListingMessages)
    const baseTurnMessages = [...priorMessages, userMessage, ...skillListingMessages]
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
              prompt,
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
        abortSignal: options.signal,
        queryTraceSink: this.queryTraceSink,
      })
    } catch (error) {
      if (
        error instanceof QueryLoopLlmError ||
        error instanceof QueryLoopAbortError
      ) {
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
      appendedMessages: [
        userMessage,
        ...skillListingMessages,
        ...response.addedMessages,
        ...hookMessages,
      ],
      outputText: response.outputText,
      sessionId: this.getSessionId(),
      ...(autoCompact ? { autoCompact } : {}),
    }
  }
}
