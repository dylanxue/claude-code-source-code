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
import {
  loadSessionMeta,
  updateSessionMeta,
  type SessionMode,
} from '../session/store.js'
import type { PermissionMode, ToolContext } from '../types/tool.js'
import {
  createTextMessage,
  getModelVisibleMessages,
  repairDanglingToolUseMessages,
  type Message,
} from '../types/message.js'
import { loadActiveExecutionTaskBoardForSession } from '../taskboard/store.js'
import { cleanupExecutionTaskBoardForTurnEnd } from '../taskboard/turnCleanup.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { SkillRegistry } from '../skills/registry.js'
import {
  DEFAULT_QUERY_MAX_ITERATIONS,
  executeSingleTurn,
  type QueryLoopRequest,
} from './queryLoop.js'
import { QueryLoopAbortError, QueryLoopLlmError } from './queryErrors.js'
import type { QueryTraceSink } from './queryTrace.js'
import type {
  RelevantMemoryPrefetchHandle,
  RelevantMemoryPrefetchResult,
  RelevantMemoryPrefetcher,
  RelevantMemoryRecentTool,
} from './relevantMemoryPrefetch.js'
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
  parseInvokedSkillReminderText,
  parseSkillListingReminderText,
} from '../skills/prompt.js'
import {
  createInvokedSkillAttachmentMessage,
  createSkillListingAttachmentMessage,
} from '../skills/runtimeAttachments.js'
import type { LoadedSkill } from '../skills/types.js'

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
  relevantMemoryPrefetcher?: RelevantMemoryPrefetcher
  onRelevantMemoryPrefetchConsumed?: (
    result: RelevantMemoryPrefetchResult,
  ) => void
  beforeCompactHook?: (state: {
    sessionId: string
    trigger: 'auto'
    queryTraceSink?: QueryTraceSink
  }) => Promise<void> | void
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
  private readonly relevantMemoryPrefetcher?: RelevantMemoryPrefetcher
  private readonly onRelevantMemoryPrefetchConsumed?: (
    result: RelevantMemoryPrefetchResult,
  ) => void
  private readonly beforeCompactHook?: QueryEngineOptions['beforeCompactHook']
  private relevantMemoryPrefetch?: RelevantMemoryPrefetchHandle
  private postCompactReadState?: {
    boundaryId: string
    entries: PostCompactReadStateSnapshot
  }
  private postCompactInvokedSkills?: {
    boundaryId: string
    skills: InvokedSkill[]
  }
  private localListedSkillNames = new Set<string>()
  private localInvokedSkillNames = new Set<string>()

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
    this.messages = repairDanglingToolUseMessages([
      ...(options.initialMessages ?? []),
    ])
    this.toolContext.invokedSkills ??= createInvokedSkillState()
    if (this.messages.length > 0) {
      restoreInvokedSkillsFromMessages(
        this.messages,
        this.toolContext.invokedSkills,
      )
    }
    this.queryTraceSink = options.queryTraceSink
    this.toolContext.queryTraceSink = this.queryTraceSink
    this.dclawMdEntries = [...(options.dclawMdEntries ?? [])]
    this.relevantMemoryPrefetcher = options.relevantMemoryPrefetcher
    this.onRelevantMemoryPrefetchConsumed =
      options.onRelevantMemoryPrefetchConsumed
    this.beforeCompactHook = options.beforeCompactHook
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
      return
    }

    this.postCompactInvokedSkills = undefined
    restoreInvokedSkillsFromMessages(messages, this.toolContext.invokedSkills)
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

  setAskUserQuestions(
    askUserQuestions: ToolContext['askUserQuestions'] | undefined,
  ): void {
    this.toolContext.askUserQuestions = askUserQuestions
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

  setSkillRegistry(skillRegistry: SkillRegistry): void {
    this.toolContext.skillRegistry = skillRegistry
    if (this.toolContext.agentRuntime) {
      this.toolContext.agentRuntime.skillRegistry = skillRegistry
    }
  }

  getSessionId(): string | undefined {
    return this.toolContext.sessionId
  }

  getQueryTracePath(): string | undefined {
    return this.queryTraceSink?.filePath
  }

  getQueryTraceSink(): QueryTraceSink | undefined {
    return this.queryTraceSink
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
    this.toolContext.readState.clear()
  }

  private getSortedCurrentSkills(): LoadedSkill[] {
    if (
      !this.toolRegistry.list().some(tool => tool.name === 'Skill') ||
      !this.toolContext.availableTools.includes('Skill') ||
      !this.toolContext.skillRegistry
    ) {
      return []
    }

    return [...this.toolContext.skillRegistry.list()].sort((left, right) => {
      if (left.name === 'install-skills' && right.name !== 'install-skills') {
        return -1
      }
      if (right.name === 'install-skills' && left.name !== 'install-skills') {
        return 1
      }
      return left.name.localeCompare(right.name)
    })
  }

  private hasRuntimeAttachment(type: NonNullable<Message['runtimeAttachment']>['type']): boolean {
    return getMessagesAfterCompactBoundary(this.messages).some(
      message => message.runtimeAttachment?.type === type,
    )
  }

  private hasPersistedInvokedSkillReminder(): boolean {
    return getMessagesAfterCompactBoundary(this.messages).some(message =>
      parseInvokedSkillReminderText(
        message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
      ),
    )
  }

  private collectListedSkillNamesFromMessages(): Set<string> {
    const names = new Set<string>()
    for (const message of getMessagesAfterCompactBoundary(this.messages)) {
      if (message.runtimeAttachment?.type === 'skill_listing') {
        for (const skill of message.runtimeAttachment.skills) {
          names.add(skill.name)
        }
        continue
      }

      const listing = parseSkillListingReminderText(
        message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
      )
      if (!listing) {
        continue
      }
      for (const skill of listing) {
        names.add(skill.name)
      }
    }
    return names
  }

  private async getSessionSkillNameState(): Promise<{
    listedSkillNames: Set<string>
    invokedSkillNames: Set<string>
  }> {
    if (!this.toolContext.sessionId) {
      return {
        listedSkillNames: new Set(this.localListedSkillNames),
        invokedSkillNames: new Set(this.localInvokedSkillNames),
      }
    }

    const meta = await loadSessionMeta(
      this.toolContext.sessionId,
      this.modelLimitsEnv,
    )
    if (!meta) {
      return {
        listedSkillNames: new Set([
          ...this.localListedSkillNames,
          ...this.collectListedSkillNamesFromMessages(),
        ]),
        invokedSkillNames: new Set(this.localInvokedSkillNames),
      }
    }

    return {
      listedSkillNames: new Set(
        meta.listedSkillNames ??
          [...this.collectListedSkillNamesFromMessages()],
      ),
      invokedSkillNames: new Set(meta.invokedSkillNames ?? []),
    }
  }

  private async persistSessionSkillNameState(state: {
    listedSkillNames: Set<string>
    invokedSkillNames: Set<string>
  }): Promise<void> {
    const listedSkillNames = [...state.listedSkillNames].sort((left, right) =>
      left.localeCompare(right),
    )
    const invokedSkillNames = [...state.invokedSkillNames].sort((left, right) =>
      left.localeCompare(right),
    )

    if (!this.toolContext.sessionId) {
      this.localListedSkillNames = new Set(listedSkillNames)
      this.localInvokedSkillNames = new Set(invokedSkillNames)
      return
    }

    const updated = await updateSessionMeta(
      this.toolContext.sessionId,
      meta => ({
        ...meta,
        listedSkillNames,
        invokedSkillNames,
        updatedAt: new Date().toISOString(),
      }),
      this.modelLimitsEnv,
    )
    if (!updated) {
      this.localListedSkillNames = new Set(listedSkillNames)
      this.localInvokedSkillNames = new Set(invokedSkillNames)
    }
  }

  private async persistCurrentInvokedSkillNames(): Promise<void> {
    const skillState = await this.getSessionSkillNameState()
    for (const skill of listInvokedSkills(this.toolContext.invokedSkills)) {
      skillState.invokedSkillNames.add(skill.name)
    }
    await this.persistSessionSkillNameState(skillState)
  }

  private async createSkillContextMessages(): Promise<Message[]> {
    const currentSkills = this.getSortedCurrentSkills()
    if (currentSkills.length === 0) {
      return []
    }

    const skillByName = new Map(currentSkills.map(skill => [skill.name, skill]))
    const skillState = await this.getSessionSkillNameState()
    for (const skill of listInvokedSkills(this.toolContext.invokedSkills)) {
      if (skillByName.has(skill.name)) {
        skillState.invokedSkillNames.add(skill.name)
      }
    }

    const messages: Message[] = []
    const hasSkillListingAttachment = this.hasRuntimeAttachment('skill_listing')
    const hasInvokedSkillContext =
      this.hasRuntimeAttachment('invoked_skills') ||
      this.hasPersistedInvokedSkillReminder()

    const invokedSkills = [...skillState.invokedSkillNames]
      .map(name => skillByName.get(name))
      .filter((skill): skill is LoadedSkill => Boolean(skill))

    if (invokedSkills.length > 0 && !hasInvokedSkillContext) {
      const message = createInvokedSkillAttachmentMessage(invokedSkills)
      if (message) {
        messages.push(message)
      }
    }

    if (
      skillState.listedSkillNames.size === 0 &&
      skillState.invokedSkillNames.size === 0
    ) {
      const message = createSkillListingAttachmentMessage('full', currentSkills)
      if (message) {
        messages.push(message)
      }
      currentSkills.forEach(skill => skillState.listedSkillNames.add(skill.name))
      await this.persistSessionSkillNameState(skillState)
      return messages
    }

    if (!hasSkillListingAttachment && skillState.listedSkillNames.size > 0) {
      const namesOnlySkills = [...skillState.listedSkillNames]
        .filter(name => !skillState.invokedSkillNames.has(name))
        .map(name => skillByName.get(name) ?? { name, description: '' })
        .filter(skill => skill.name.length > 0)
      const message = createSkillListingAttachmentMessage(
        'names_only',
        namesOnlySkills,
      )
      if (message) {
        messages.push(message)
      }
    }

    const newSkills = currentSkills.filter(
      skill =>
        !skillState.listedSkillNames.has(skill.name) &&
        !skillState.invokedSkillNames.has(skill.name),
    )
    if (newSkills.length > 0) {
      const message = createSkillListingAttachmentMessage('delta', newSkills)
      if (message) {
        messages.push(message)
      }
      newSkills.forEach(skill => skillState.listedSkillNames.add(skill.name))
    }

    await this.persistSessionSkillNameState(skillState)
    return messages
  }

  private collectSurfacedMemoryState(): {
    paths: Set<string>
    totalBytes: number
  } {
    const paths = new Set<string>()
    let totalBytes = 0

    for (const message of getMessagesAfterCompactBoundary(this.messages)) {
      if (message.runtimeAttachment?.type !== 'relevant_memories') {
        continue
      }

      for (const memory of message.runtimeAttachment.memories) {
        paths.add(memory.path)
        if (memory.relativePath) {
          paths.add(memory.relativePath)
        }
        totalBytes += memory.content?.length ?? 0
      }
    }

    return { paths, totalBytes }
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

  private startRelevantMemoryPrefetch(
    userPrompt: string,
    recentTools: RelevantMemoryRecentTool[],
    abortSignal: AbortSignal | undefined,
  ): void {
    if (!this.relevantMemoryPrefetcher || this.relevantMemoryPrefetch) {
      return
    }

    const surfaced = this.collectSurfacedMemoryState()
    this.relevantMemoryPrefetch = this.relevantMemoryPrefetcher({
      userPrompt,
      recentTools,
      abortSignal,
      queryTraceSink: this.queryTraceSink,
      excludedPaths: surfaced.paths,
      remainingSessionBytes: Math.max(
        0,
        64_000 - surfaced.totalBytes,
      ),
    })
  }

  private consumeSettledRelevantMemoryPrefetch(): Message[] {
    const result = this.relevantMemoryPrefetch?.getSettled()
    if (!result) {
      return []
    }

    this.relevantMemoryPrefetch = undefined
    this.onRelevantMemoryPrefetchConsumed?.(result)
    if (result.messages.length > 0) {
      this.messages.push(...result.messages)
    }
    return result.messages
  }

  private abortRelevantMemoryPrefetch(): void {
    this.relevantMemoryPrefetch?.abort()
    this.relevantMemoryPrefetch = undefined
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
    transientMessages.push(...this.consumeSettledRelevantMemoryPrefetch())
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

    const sessionMeta = await loadSessionMeta(
      this.toolContext.sessionId,
      this.modelLimitsEnv,
    )
    const planMode = sessionMeta?.planMode
    const planFilePath = planMode?.planFilePath ?? this.toolContext.planFilePath
    const allMessages = baseMessages
    const messages = visibleMessages
    const recoveryReadState = this.postCompactReadState?.entries
    const invokedSkills = listInvokedSkills(this.toolContext.invokedSkills)
    const postCompactAttachments = await createPostCompactAttachmentMessages(
      allMessages,
      planFilePath,
      recoveryReadState,
      invokedSkills,
      this.toolContext.availableTools,
    )
    transientMessages.push(...postCompactAttachments)

    const postCompactPlanModeReminder = createPostCompactPlanModeReminderMessage(
      allMessages,
      planMode,
      this.toolContext.permissionMode,
    )
    if (postCompactPlanModeReminder) {
      transientMessages.push(postCompactPlanModeReminder)
    } else {
      const planModeReminderMessages = await createPlanModeReminderMessages(
        messages,
        planMode,
        this.toolContext.permissionMode,
        this.toolContext.sessionId,
        this.modelLimitsEnv,
      )
      transientMessages.push(...planModeReminderMessages)
    }

    const executionBoard = await loadActiveExecutionTaskBoardForSession(
      this.toolContext.sessionId,
      this.modelLimitsEnv,
    )
    const taskReminderMessage = createTaskToolReminderMessage(
      messages,
      executionBoard,
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
      ? {
          ...deriveToolResultBudgetFromModelLimits(modelLimits),
          workspaceRoot: this.toolContext.cwd,
          env: this.modelLimitsEnv ?? process.env,
        }
      : undefined
  }

  private resetTurnScopedTaskState(): void {
    this.toolContext.activeExecutionTaskBoardIdThisTurn = undefined
    this.toolContext.taskTurnHandoffReason = undefined
  }

  private async cleanupExecutionTaskBoard(
    reason:
      | 'assistant_handoff'
      | 'permission_denied'
      | 'abort'
      | 'llm_error'
      | 'max_iterations',
  ): Promise<void> {
    if (!this.toolContext.sessionId) {
      return
    }

    try {
      await cleanupExecutionTaskBoardForTurnEnd(
        this.toolContext.sessionId,
        reason,
        this.modelLimitsEnv,
      )
    } catch {
      // Best-effort cleanup; do not fail the main turn if task-board cleanup fails.
    }
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
      await this.beforeCompactHook?.({
        sessionId: sourceSessionId,
        trigger: 'auto',
        queryTraceSink: this.queryTraceSink,
      })
      const {
        boundary,
        boundaryMessage,
        summaryMessage,
        messagesToKeep,
      } = await compactSession({
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
        queryTraceSink: this.queryTraceSink,
        env: this.modelLimitsEnv,
      })

      this.preparePostCompactRecovery(boundary.boundaryId)
      this.messages.push(boundaryMessage, summaryMessage, ...messagesToKeep)

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
    const skillListingMessages = await this.createSkillContextMessages()
    this.messages.push(userMessage, ...skillListingMessages)
    const baseTurnMessages = [...priorMessages, userMessage, ...skillListingMessages]
    const persistedMessagesWithUser = this.getMessages()
    const modelLimits = this.getResolvedModelLimits()
    const toolResultBudgetOptions = this.getResolvedToolResultBudgetOptions()
    this.resetTurnScopedTaskState()
    this.abortRelevantMemoryPrefetch()
    this.startRelevantMemoryPrefetch(prompt, [], options.signal)

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
        onToolResultsComplete: state => {
          this.startRelevantMemoryPrefetch(
            prompt,
            state.tools,
            options.signal,
          )
        },
      })
    } catch (error) {
      if (
        error instanceof QueryLoopLlmError ||
        error instanceof QueryLoopAbortError
      ) {
        if (error.addedMessages.length > 0) {
          this.messages.push(
            ...repairDanglingToolUseMessages(error.addedMessages),
          )
        }
        if (error.usedPostCompactAttachments) {
          this.postCompactReadState = undefined
        }
      }
      if (error instanceof QueryLoopLlmError) {
        await this.cleanupExecutionTaskBoard('llm_error')
      } else if (error instanceof QueryLoopAbortError) {
        this.abortRelevantMemoryPrefetch()
        await this.cleanupExecutionTaskBoard('abort')
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

    await this.cleanupExecutionTaskBoard(response.turnEndReason)
    await this.persistCurrentInvokedSkillNames()
    this.abortRelevantMemoryPrefetch()

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
