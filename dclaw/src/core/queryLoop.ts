import { evaluateCompactPressure } from '../compact/pressure.js'
import { computeContextStats } from './contextStats.js'
import type { LlmClient } from '../llm/types.js'
import type { ModelLimits } from '../llm/modelLimits.js'
import {
  getProviderErrorKind,
  getProviderErrorSubtype,
  type ProviderErrorKind,
  type ProviderErrorSubtype,
  stringifyJson,
} from '../llm/providerUtils.js'
import {
  createToolResultMessage,
  createTextMessage,
  getModelVisibleMessages,
  getTextContent,
  getToolUseBlocks,
  repairDanglingToolUseMessages,
  withRuntimeAttachment,
  type ContentBlock,
  type Message,
  type RuntimeAttachment,
} from '../types/message.js'
import type {
  ToolContext,
  ToolResult as ToolExecutionResult,
} from '../types/tool.js'
import { evaluateToolPermission } from '../permissions/evaluator.js'
import type { ToolRegistry } from '../tools/registry.js'
import { validateJsonSchema } from '../tools/schema.js'
import type { Tool } from '../tools/types.js'
import {
  applyToolResultBudget,
  type ToolResultBudgetMetadata,
  type ToolResultBudgetOptions,
} from './toolResultBudget.js'
import { QueryLoopAbortError, QueryLoopLlmError } from './queryErrors.js'
import type { QueryTraceSink } from './queryTrace.js'
import type { RelevantMemoryRecentTool } from './relevantMemoryPrefetch.js'
import {
  isExecutionBoardActive,
  loadExecutionTaskBoardForSession,
} from '../taskboard/store.js'
import type { TaskBoard } from '../taskboard/types.js'
import { loadSessionMeta, type PlanModeState } from '../session/store.js'

const APPROX_ASCII_CHARS_PER_TOKEN = 4
const STREAM_OUTPUT_GUARD_RATIO = 0.95

export type QueryLoopRequest = {
  client: LlmClient
  model?: string
  modelLimits?: ModelLimits
  systemPrompt?: string
  messages: Message[]
  resolveIterationRequest?: (messages: Message[]) => Promise<{
    systemPrompt?: string
    messages?: Message[]
    usedPostCompactAttachments?: boolean
  }>
  toolRegistry: ToolRegistry
  toolContext: ToolContext
  maxIterations?: number
  toolResultBudgetOptions?: ToolResultBudgetOptions
  queryTraceSink?: QueryTraceSink
  abortSignal?: AbortSignal
  onToolResultsComplete?: (state: {
    iteration: number
    tools: RelevantMemoryRecentTool[]
  }) => void
  streamHandlers?: {
    onTextDelta?: (text: string) => void
    onReasoningDelta?: (delta: {
      iteration: number
      kind: 'reasoning' | 'thinking'
      text: string
    }) => void
    onAssistantMessage?: (message: {
      iteration: number
      id: string
      role: Message['role']
      content: ContentBlock[]
    }) => void
    onToolUse?: (toolUse: {
      iteration: number
      id: string
      name: string
      input: Record<string, unknown>
    }) => void
    onToolResult?: (toolResult: {
      iteration: number
      toolUseId: string
      output: unknown
      sessionId?: string
      taskBoard?: TaskBoard
      planMode?: PlanModeState
    }) => void
    onLlmError?: (error: {
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
    }) => void
    onCompactDryRun?: (event: {
      iteration: number
      phase: 'iteration_start' | 'post_tool_results'
      recommendation: ReturnType<typeof getCompactRecommendationForTrace>
      contextStats: ReturnType<typeof getContextStatsForTrace>
    }) => void
    onAutoCompact?: (event: {
      sessionId: string
      boundaryId: string
      reason: string
      summaryMessageId: string
    }) => void
  }
}

export type QueryLoopResult = {
  assistantMessage: Message
  toolResultMessages: Message[]
  addedMessages: Message[]
  outputText: string
  iterations: number
  usedPostCompactAttachments: boolean
  turnEndReason: 'assistant_handoff' | 'permission_denied' | 'max_iterations'
}

export const DEFAULT_QUERY_MAX_ITERATIONS = 128

function shouldEmitTaskBoardSnapshot(
  toolName: string,
  result: ToolExecutionResult<unknown>,
): boolean {
  if (toolName === 'TaskCreate') {
    return result.ok
  }

  if (toolName !== 'TaskUpdate' || !result.ok) {
    return false
  }

  if (typeof result.output !== 'object' || result.output === null) {
    return false
  }

  return (result.output as { success?: unknown }).success === true
}

function shouldEmitPlanModeSnapshot(
  toolName: string,
  result: ToolExecutionResult<unknown>,
): boolean {
  return (
    result.ok &&
    toolName === 'ExitPlanMode'
  )
}

function throwIfAborted(
  request: QueryLoopRequest,
  options: {
    addedMessages?: Message[]
    usedPostCompactAttachments?: boolean
  } = {},
): void {
  if (!request.abortSignal?.aborted) {
    return
  }

  recordTrace(request.queryTraceSink, 'turn.abort', {
    addedMessageCount: options.addedMessages?.length ?? 0,
  })
  throw new QueryLoopAbortError({
    ...options,
    addedMessages: options.addedMessages
      ? repairDanglingToolUseMessages(options.addedMessages)
      : undefined,
  })
}

function countAsciiChars(text: string): number {
  let asciiChars = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) <= 0x7f) {
      asciiChars += 1
    }
  }
  return asciiChars
}

function getApproxOutputTokens(
  asciiChars: number,
  nonAsciiChars: number,
): number {
  return Math.ceil(asciiChars / APPROX_ASCII_CHARS_PER_TOKEN) + nonAsciiChars
}

function getStreamOutputGuardThresholdTokens(
  modelLimits: ModelLimits | undefined,
): number | undefined {
  if (!modelLimits || modelLimits.maxOutputTokens < 1) {
    return undefined
  }

  return Math.max(
    1,
    Math.min(
      modelLimits.maxOutputTokens,
      Math.floor(modelLimits.maxOutputTokens * STREAM_OUTPUT_GUARD_RATIO),
    ),
  )
}

async function resolveIterationState(
  request: QueryLoopRequest,
  workingMessages: Message[],
): Promise<{
  systemPrompt?: string
  messages: Message[]
  toolDefinitions: Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }>
  usedPostCompactAttachments: boolean
}> {
  const resolved = request.resolveIterationRequest
    ? await request.resolveIterationRequest(workingMessages)
    : undefined
  const messages = getModelVisibleMessages(
    resolved?.messages ?? workingMessages,
  )
  const availableTools = getAvailableTools(
    request.toolRegistry,
    request.toolContext,
  )
  const toolDefinitions = await Promise.all(
    availableTools.map(tool => toToolDefinition(tool, request.toolContext)),
  )

  return {
    systemPrompt: resolved?.systemPrompt ?? request.systemPrompt,
    messages,
    toolDefinitions,
    usedPostCompactAttachments: resolved?.usedPostCompactAttachments === true,
  }
}

function stringifyOutput(value: unknown): string {
  return stringifyJson(value)
}

function createSystemReminderMessage(
  text: string,
  runtimeAttachment?: RuntimeAttachment,
): Message {
  const message = createTextMessage(
    'user',
    `<system-reminder>\n${text}\n</system-reminder>`,
  )
  return runtimeAttachment
    ? withRuntimeAttachment(message, runtimeAttachment)
    : message
}

function normalizeToolUseIntentText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= 800
    ? normalized
    : `${normalized.slice(0, 800).trimEnd()}...`
}

function isSystemReminderText(text: string): boolean {
  return text.trimStart().startsWith('<system-reminder>')
}

function getLatestUserRequestEntry(messages: Message[]): {
  index: number
  text: string
} | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user' || message.transcriptOnly === true) {
      continue
    }

    const text = getTextContent(message).trim()
    if (text.length > 0 && !isSystemReminderText(text)) {
      return {
        index,
        text,
      }
    }
  }

  return undefined
}

function getReasoningText(block: ContentBlock): string | undefined {
  if (block.type === 'thinking') {
    return block.thinking
  }
  if (block.type === 'reasoning') {
    return block.summary.join(' ')
  }
  return undefined
}

function buildToolUseIntentFromBlocks(
  relevantBlocks: ContentBlock[],
): ToolContext['toolUseIntent'] {
  const assistantText = relevantBlocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (assistantText.length > 0) {
    return {
      source: 'assistant_text',
      text: normalizeToolUseIntentText(assistantText),
    }
  }

  const reasoningText = relevantBlocks
    .map(getReasoningText)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim()
  if (reasoningText.length > 0) {
    return {
      source: 'reasoning',
      text: normalizeToolUseIntentText(reasoningText),
    }
  }

  return undefined
}

function getLatestAssistantIntentAfter(
  messages: Message[],
  afterIndex: number,
): ToolContext['toolUseIntent'] {
  for (let index = messages.length - 1; index > afterIndex; index -= 1) {
    const message = messages[index]
    if (
      !message ||
      message.role !== 'assistant' ||
      message.transcriptOnly === true
    ) {
      continue
    }

    const intent = buildToolUseIntentFromBlocks(message.content)
    if (intent) {
      return intent
    }
  }

  return undefined
}

function buildToolUseIntent(
  assistantMessage: Message,
  toolUseId: string,
  fallbackAssistantIntent: ToolContext['toolUseIntent'],
  fallbackUserRequest: string | undefined,
): ToolContext['toolUseIntent'] {
  const toolUseIndex = assistantMessage.content.findIndex(
    block => block.type === 'tool_use' && block.id === toolUseId,
  )
  const relevantBlocks =
    toolUseIndex >= 0
      ? assistantMessage.content.slice(0, toolUseIndex)
      : assistantMessage.content

  const localIntent = buildToolUseIntentFromBlocks(relevantBlocks)
  if (localIntent) {
    return localIntent
  }

  if (fallbackAssistantIntent) {
    return fallbackAssistantIntent
  }

  if (fallbackUserRequest && fallbackUserRequest.trim().length > 0) {
    return {
      source: 'user_request',
      text: normalizeToolUseIntentText(fallbackUserRequest),
    }
  }

  return undefined
}

function hasRepairableEmptyAssistantResponse(message: Message): boolean {
  if (getToolUseBlocks(message).length > 0) {
    return false
  }

  if (getTextContent(message).trim().length > 0) {
    return false
  }

  return message.content.some(
    block =>
      block.type === 'thinking' ||
      block.type === 'reasoning' ||
      block.type === 'redacted_thinking',
  )
}

function buildEmptyTurnRepairReminderMessage(): Message {
  return createSystemReminderMessage(
    [
      'Your previous response contained no user-visible text and no valid tool call.',
      'If you intended to use a tool, emit a valid tool call now using the standard tool-calling protocol.',
      'Otherwise, answer directly with normal text.',
      'Do not place tool-call syntax inside thinking or reasoning.',
    ].join('\n'),
  )
}

function buildEmptyTurnRepairFailureMessage(
  attemptedRepair: boolean,
): Message {
  return createTextMessage(
    'assistant',
    attemptedRepair
      ? 'The model returned no final text or valid tool call, even after a repair attempt. Please retry the request or switch to a model with more reliable tool-calling behavior.'
      : 'The model returned no final text or valid tool call. Please retry the request or switch to a model with more reliable tool-calling behavior.',
  )
}

function formatExecutionTaskPreview(board: TaskBoard): string[] {
  return board.tasks.map(task => {
    const blocked =
      task.blockedBy.length > 0
        ? ` [blocked by ${task.blockedBy.map(id => `#${id}`).join(', ')}]`
        : ''
    return `- #${task.id} [${task.status}] ${task.subject}${blocked}`
  })
}

function buildActiveExecutionTaskContinuationReminderMessage(
  board: TaskBoard,
): Message {
  const currentTask = board.tasks.find(task => task.id === board.currentTaskId)
  const lines = [
    'You still have an active execution task list in this turn.',
    'Do not end the turn with ordinary assistant text while pending or in_progress tasks remain.',
    'Continue implementation by updating the current task state, checking the task list, or completing the next actionable step.',
  ]

  if (currentTask) {
    lines.push(
      `Current task: #${currentTask.id} [${currentTask.status}] ${currentTask.subject}`,
    )
  }
  if (board.currentStep) {
    lines.push(`Current step: ${board.currentStep}`)
  }

  lines.push('Current execution tasks:')
  lines.push(...formatExecutionTaskPreview(board))

  return createSystemReminderMessage(lines.join('\n'), {
    type: 'task_reminder',
    subtype: 'active_execution_continuation',
  })
}

function resolveTurnEndReason(
  toolContext: ToolContext,
): 'assistant_handoff' | 'permission_denied' {
  return toolContext.taskTurnHandoffReason === 'permission_denied'
    ? 'permission_denied'
    : 'assistant_handoff'
}

function summarizeToolResultContent(
  result: ToolExecutionResult,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(result.content) || result.content.length === 0) {
    return undefined
  }

  return result.content.map(block =>
    block.type === 'text'
      ? {
          type: 'text',
          textPreview: truncateForTrace(block.text, 240),
        }
      : block.type === 'image'
      ? {
          type: 'image',
          mediaType: block.source.mediaType,
          dataChars: block.source.data.length,
        }
      : {
          type: 'pdf',
          mediaType: block.source.mediaType,
          dataChars: block.source.data.length,
          filename: block.filename,
        },
  )
}

function truncateForTrace(value: string, maxLength: number = 2_000): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}...`
}

function getSandboxModeFromToolOutput(output: unknown): string | undefined {
  if (typeof output !== 'object' || output === null) {
    return undefined
  }

  if (
    'sandboxMode' in output &&
    typeof output.sandboxMode === 'string'
  ) {
    return output.sandboxMode
  }

  if (
    'output' in output &&
    typeof output.output === 'object' &&
    output.output !== null &&
    'sandboxMode' in output.output &&
    typeof output.output.sandboxMode === 'string'
  ) {
    return output.output.sandboxMode
  }

  return undefined
}

function summarizeMessageForTrace(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    contentTypes: message.content.map(block => block.type),
    text: truncateForTrace(getTextContent(message)),
    reasoning: message.content
      .filter(
        (
          block,
        ): block is Extract<ContentBlock, { type: 'reasoning' }> =>
          block.type === 'reasoning',
      )
      .map(block => ({
        id: block.id,
        summary: block.summary.map(text => truncateForTrace(text, 500)),
        status: block.status,
        encryptedContentPresent: Boolean(block.encryptedContent),
      })),
    thinking: message.content
      .filter(
        (
          block,
        ): block is
          | Extract<ContentBlock, { type: 'thinking' }>
          | Extract<ContentBlock, { type: 'redacted_thinking' }> =>
          block.type === 'thinking' || block.type === 'redacted_thinking',
      )
      .map(block =>
        block.type === 'thinking'
          ? {
              type: block.type,
              thinking: truncateForTrace(block.thinking, 500),
              signaturePresent: Boolean(block.signature),
            }
          : {
              type: block.type,
              dataPresent: block.data.length > 0,
            },
      ),
    toolUses: getToolUseBlocks(message).map(block => ({
      id: block.id,
      name: block.name,
      input: block.input,
    })),
    toolResults: message.content
      .filter(
        (
          block,
        ): block is Extract<ContentBlock, { type: 'tool_result' }> =>
          block.type === 'tool_result',
      )
      .map(block => ({
        toolUseId: block.toolUseId,
        outputPreview: truncateForTrace(stringifyOutput(block.output), 500),
        content:
          block.content?.map(item =>
            item.type === 'text'
              ? {
                  type: 'text',
                  textPreview: truncateForTrace(item.text, 240),
                }
              : item.type === 'image'
              ? {
                  type: 'image',
                  mediaType: item.source.mediaType,
                  dataChars: item.source.data.length,
                }
              : {
                  type: 'pdf',
                  mediaType: item.source.mediaType,
                  dataChars: item.source.data.length,
                  filename: item.filename,
                },
          ) ?? [],
      })),
  }
}

function recordTrace(
  sink: QueryTraceSink | undefined,
  event: string,
  data?: Record<string, unknown>,
  iteration?: number,
): void {
  sink?.record({
    event,
    ...(iteration === undefined ? {} : { iteration }),
    ...(data === undefined ? {} : { data }),
  })
}

function getContextStatsForTrace(request: QueryLoopRequest, messages: Message[]) {
  return computeContextStats(messages, {
    modelLimits: request.modelLimits,
    toolResultBudgetOptions: request.toolResultBudgetOptions,
  })
}

function getCompactRecommendationForTrace(
  request: QueryLoopRequest,
  messages: Message[],
) {
  return evaluateCompactPressure(getContextStatsForTrace(request, messages))
}

function emitCompactDryRun(
  request: QueryLoopRequest,
  iteration: number,
  phase: 'iteration_start' | 'post_tool_results',
  messages: Message[],
): void {
  const contextStats = getContextStatsForTrace(request, messages)
  const recommendation = evaluateCompactPressure(contextStats)
  if (!recommendation.shouldCompact) {
    return
  }

  recordTrace(
    request.queryTraceSink,
    'compact.dry_run',
    {
      phase,
      contextStats,
      compactRecommendation: recommendation,
    },
    iteration,
  )
  request.streamHandlers?.onCompactDryRun?.({
    iteration,
    phase,
    recommendation,
    contextStats,
  })
}

async function toToolDefinition(
  tool: Tool,
  context: ToolContext,
): Promise<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}> {
  return {
    name: tool.name,
    description: await tool.prompt(context),
    inputSchema: tool.inputSchema,
  }
}

function getAvailableTools(
  toolRegistry: ToolRegistry,
  context: ToolContext,
): Tool[] {
  return toolRegistry.list().filter(tool => {
    if (
      context.availableTools.length > 0 &&
      !context.availableTools.includes(tool.name)
    ) {
      return false
    }

    return tool.isEnabled(context)
  })
}

export async function executeSingleTurn(
  request: QueryLoopRequest,
): Promise<QueryLoopResult> {
  throwIfAborted(request)
  const maxIterations = request.maxIterations ?? DEFAULT_QUERY_MAX_ITERATIONS
  const workingMessages = [...request.messages]
  const addedMessages: Message[] = []
  let lastAssistantMessage: Message | undefined
  let lastToolResultMessages: Message[] = []
  let outputText = ''
  let usedPostCompactAttachments = false
  let emptyTurnRepairAttempted = false
  let pendingEmptyTurnRepairMessages: Message[] = []
  let executionTurnEndRepairAttempted = false
  let pendingExecutionTurnRepairMessages: Message[] = []
  const initialIterationState = await resolveIterationState(
    request,
    workingMessages,
  )
  usedPostCompactAttachments ||= initialIterationState.usedPostCompactAttachments
  recordTrace(request.queryTraceSink, 'turn.start', {
    model: request.model ?? 'default',
    modelLimits: request.modelLimits,
    toolResultBudget: request.toolResultBudgetOptions
      ? {
          defaultMaxResultSizeChars:
            request.toolResultBudgetOptions.defaultMaxResultSizeChars,
          maxToolResultsPerTurnChars:
            request.toolResultBudgetOptions.maxToolResultsPerTurnChars,
          previewChars: request.toolResultBudgetOptions.previewChars,
        }
      : undefined,
    messageCount: initialIterationState.messages.length,
    contextStats: getContextStatsForTrace(
      request,
      initialIterationState.messages,
    ),
    compactRecommendation: getCompactRecommendationForTrace(
      request,
      initialIterationState.messages,
    ),
    availableTools: initialIterationState.toolDefinitions.map(tool => tool.name),
    permissionMode: request.toolContext.permissionMode,
    cwd: request.toolContext.cwd,
    lastMessage:
      workingMessages.length > 0
        ? summarizeMessageForTrace(workingMessages.at(-1)!)
        : undefined,
  })

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      throwIfAborted(request, {
        addedMessages,
        usedPostCompactAttachments,
      })
      const baseIterationState =
        iteration === 1
          ? initialIterationState
          : await resolveIterationState(request, workingMessages)
      if (iteration > 1) {
        usedPostCompactAttachments ||= baseIterationState.usedPostCompactAttachments
      }
      const repairMessagesForIteration = [
        ...pendingEmptyTurnRepairMessages,
        ...pendingExecutionTurnRepairMessages,
      ]
      pendingEmptyTurnRepairMessages = []
      pendingExecutionTurnRepairMessages = []
      const iterationState = {
        ...baseIterationState,
        messages: [
          ...baseIterationState.messages,
          ...repairMessagesForIteration,
        ],
      }
      recordTrace(
        request.queryTraceSink,
        'iteration.start',
        {
          messageCount: iterationState.messages.length,
          contextStats: getContextStatsForTrace(
            request,
            iterationState.messages,
          ),
          compactRecommendation: getCompactRecommendationForTrace(
            request,
            iterationState.messages,
          ),
        },
        iteration,
      )
      emitCompactDryRun(
        request,
        iteration,
        'iteration_start',
        iterationState.messages,
      )

      const useStreaming = Boolean(
        request.streamHandlers && request.client.createMessageStream,
      )
      let streamedTextChars = 0
      let streamedReasoningChars = 0
      let streamedAsciiChars = 0
      let streamedNonAsciiChars = 0
      let lastTextDelta: string | undefined
      let lastReasoningDelta:
        | {
            kind: 'reasoning' | 'thinking'
            text: string
          }
        | undefined
      const streamOutputGuardThresholdTokens =
        getStreamOutputGuardThresholdTokens(request.modelLimits)
      const throwIfStreamOutputGuardExceeded = (): void => {
        if (streamOutputGuardThresholdTokens === undefined) {
          return
        }

        const approxOutputTokens = getApproxOutputTokens(
          streamedAsciiChars,
          streamedNonAsciiChars,
        )
        if (approxOutputTokens < streamOutputGuardThresholdTokens) {
          return
        }

        recordTrace(
          request.queryTraceSink,
          'llm.output_guard.triggered',
          {
            approxOutputTokens,
            thresholdTokens: streamOutputGuardThresholdTokens,
            maxOutputTokens: request.modelLimits?.maxOutputTokens,
            streamedTextChars,
            streamedReasoningChars,
          },
          iteration,
        )

        throw new Error(
          `Aborted streaming response after estimated output reached ${approxOutputTokens} tokens (guard threshold ${streamOutputGuardThresholdTokens}/${request.modelLimits?.maxOutputTokens ?? 'unknown'}).`,
        )
      }
      recordTrace(
        request.queryTraceSink,
        'llm.request',
        {
          model: request.model ?? 'default',
          streaming: useStreaming,
          systemPrompt: iterationState.systemPrompt,
          messageCount: iterationState.messages.length,
          messages: iterationState.messages.map(summarizeMessageForTrace),
          toolNames: iterationState.toolDefinitions.map(tool => tool.name),
        },
        iteration,
      )

      let streamedResponse
      try {
        throwIfAborted(request, {
          addedMessages,
          usedPostCompactAttachments,
        })
        streamedResponse =
          useStreaming
            ? await request.client.createMessageStream!.call(
                request.client,
                {
                  model: request.model,
                  systemPrompt: iterationState.systemPrompt,
                  messages: iterationState.messages,
                  tools: iterationState.toolDefinitions,
                  signal: request.abortSignal,
                },
                {
                  onTextDelta: text => {
                    throwIfAborted(request, {
                      addedMessages,
                      usedPostCompactAttachments,
                    })
                    streamedTextChars += text.length
                    const asciiChars = countAsciiChars(text)
                    streamedAsciiChars += asciiChars
                    streamedNonAsciiChars += text.length - asciiChars
                    lastTextDelta = text
                    recordTrace(
                      request.queryTraceSink,
                      'llm.text.delta',
                      { text },
                      iteration,
                    )
                    request.streamHandlers?.onTextDelta?.(text)
                    throwIfAborted(request, {
                      addedMessages,
                      usedPostCompactAttachments,
                    })
                    throwIfStreamOutputGuardExceeded()
                  },
                  onReasoningDelta: delta => {
                    throwIfAborted(request, {
                      addedMessages,
                      usedPostCompactAttachments,
                    })
                    streamedReasoningChars += delta.text.length
                    const asciiChars = countAsciiChars(delta.text)
                    streamedAsciiChars += asciiChars
                    streamedNonAsciiChars += delta.text.length - asciiChars
                    lastReasoningDelta = delta
                    recordTrace(
                      request.queryTraceSink,
                      'llm.reasoning.delta',
                      {
                        kind: delta.kind,
                        text: truncateForTrace(delta.text, 500),
                      },
                      iteration,
                    )
                    request.streamHandlers?.onReasoningDelta?.({
                      iteration,
                      kind: delta.kind,
                      text: delta.text,
                    })
                    throwIfAborted(request, {
                      addedMessages,
                      usedPostCompactAttachments,
                    })
                    throwIfStreamOutputGuardExceeded()
                  },
                },
              )
            : await request.client.createMessage({
                model: request.model,
                systemPrompt: iterationState.systemPrompt,
                messages: iterationState.messages,
                tools: iterationState.toolDefinitions,
                signal: request.abortSignal,
              })
      } catch (error) {
        if (request.abortSignal?.aborted) {
          throw new QueryLoopAbortError({
            addedMessages: repairDanglingToolUseMessages(addedMessages),
            usedPostCompactAttachments,
          })
        }

        const errorMessage =
          error instanceof Error ? error.message : 'Unknown LLM error'
        const llmError = {
          iteration,
          streaming: useStreaming,
          phase:
            streamedTextChars > 0 || streamedReasoningChars > 0
              ? 'during_stream'
              : 'before_response',
          kind: getProviderErrorKind(error),
          subtype: getProviderErrorSubtype(error),
          errorName: error instanceof Error ? error.name : undefined,
          message: errorMessage,
          streamedTextChars,
          streamedReasoningChars,
          ...(lastTextDelta === undefined
            ? {}
            : { lastTextDelta: truncateForTrace(lastTextDelta, 500) }),
          ...(lastReasoningDelta === undefined
            ? {}
            : {
                lastReasoningDelta: {
                  kind: lastReasoningDelta.kind,
                  text: truncateForTrace(lastReasoningDelta.text, 500),
                },
              }),
        } as const
        recordTrace(
          request.queryTraceSink,
          'llm.error',
          llmError,
          iteration,
        )
        request.streamHandlers?.onLlmError?.(llmError)
        throw new QueryLoopLlmError(error, llmError, {
          addedMessages,
          usedPostCompactAttachments,
        })
      }
      const assistantMessage = streamedResponse.message
      lastAssistantMessage = assistantMessage
      request.toolContext.activeTurnId = assistantMessage.id
      workingMessages.push(assistantMessage)
      addedMessages.push(assistantMessage)
      request.streamHandlers?.onAssistantMessage?.({
        iteration,
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content,
      })

      const toolUseBlocks = getToolUseBlocks(assistantMessage)
      recordTrace(
        request.queryTraceSink,
        'llm.response',
        {
          assistantMessage: summarizeMessageForTrace(assistantMessage),
          fullAssistantMessage: assistantMessage,
          outputText: getTextContent(assistantMessage),
          toolUseCount: toolUseBlocks.length,
        },
        iteration,
      )

      for (const block of toolUseBlocks) {
        recordTrace(
          request.queryTraceSink,
          'tool.use',
          {
            toolUseId: block.id,
            name: block.name,
            input: block.input,
          },
          iteration,
        )
        request.streamHandlers?.onToolUse?.({
          iteration,
          id: block.id,
          name: block.name,
          input: block.input,
        })
      }
      if (hasRepairableEmptyAssistantResponse(assistantMessage)) {
        recordTrace(
          request.queryTraceSink,
          'llm.empty_turn.detected',
          {
            attemptedRepair: emptyTurnRepairAttempted,
            contentTypes: assistantMessage.content.map(block => block.type),
          },
          iteration,
        )

        if (!emptyTurnRepairAttempted && iteration < maxIterations) {
          const repairReminderMessage = buildEmptyTurnRepairReminderMessage()
          pendingEmptyTurnRepairMessages = [repairReminderMessage]
          emptyTurnRepairAttempted = true
          recordTrace(
            request.queryTraceSink,
            'llm.empty_turn.repair_scheduled',
            {
              reminderMessage: summarizeMessageForTrace(repairReminderMessage),
            },
            iteration,
          )
          continue
        }

        const repairFailureMessage = buildEmptyTurnRepairFailureMessage(
          emptyTurnRepairAttempted,
        )
        outputText = getTextContent(repairFailureMessage)
        addedMessages.push(repairFailureMessage)
        recordTrace(
          request.queryTraceSink,
          'llm.empty_turn.repair_failed',
          {
            attemptedRepair: emptyTurnRepairAttempted,
            outputText: truncateForTrace(outputText),
          },
          iteration,
        )
        recordTrace(request.queryTraceSink, 'turn.complete', {
          iterations: iteration,
          outputText: truncateForTrace(outputText),
        })
        return {
          assistantMessage: repairFailureMessage,
          toolResultMessages: lastToolResultMessages,
          addedMessages,
          outputText,
          iterations: iteration,
          usedPostCompactAttachments,
          turnEndReason: resolveTurnEndReason(request.toolContext),
        }
      }
      if (toolUseBlocks.length === 0) {
        const activeExecutionBoard = request.toolContext.sessionId
          ? await loadExecutionTaskBoardForSession(request.toolContext.sessionId)
          : null
        const shouldGuardTurnEnd =
          activeExecutionBoard !== null &&
          isExecutionBoardActive(activeExecutionBoard) &&
          !request.toolContext.taskTurnHandoffReason
        if (shouldGuardTurnEnd) {
          recordTrace(
            request.queryTraceSink,
            'turn.execution_guard.detected',
            {
              boardId: activeExecutionBoard.boardId,
              currentTaskId: activeExecutionBoard.currentTaskId,
            },
            iteration,
          )

          if (!executionTurnEndRepairAttempted && iteration < maxIterations) {
            const reminderMessage =
              buildActiveExecutionTaskContinuationReminderMessage(
                activeExecutionBoard,
              )
            pendingExecutionTurnRepairMessages = [reminderMessage]
            executionTurnEndRepairAttempted = true
            recordTrace(
              request.queryTraceSink,
              'turn.execution_guard.repair_scheduled',
              {
                reminderMessage: summarizeMessageForTrace(reminderMessage),
              },
              iteration,
            )
            continue
          }
        }

        outputText = getTextContent(assistantMessage)
        recordTrace(
          request.queryTraceSink,
          'iteration.complete.no_tool_use',
          {
            outputText: truncateForTrace(outputText),
          },
          iteration,
        )
        recordTrace(request.queryTraceSink, 'turn.complete', {
          iterations: iteration,
          outputText: truncateForTrace(outputText),
        })
        return {
          assistantMessage,
          toolResultMessages: lastToolResultMessages,
          addedMessages,
          outputText,
          iterations: iteration,
          usedPostCompactAttachments,
          turnEndReason: resolveTurnEndReason(request.toolContext),
        }
      }

      const toolResultMessages: Message[] = []
      const toolGeneratedMessages: Message[] = []
      const toolResultMetadata = new Map<string, ToolResultBudgetMetadata>()
      const latestUserRequestEntry = getLatestUserRequestEntry(workingMessages)
      const latestUserRequest = latestUserRequestEntry?.text
      const fallbackAssistantIntent = getLatestAssistantIntentAfter(
        workingMessages.slice(0, -1),
        latestUserRequestEntry?.index ?? -1,
      )
      request.toolContext.currentIteration = iteration
      request.toolContext.currentUserRequest = latestUserRequest
      for (const block of toolUseBlocks) {
        throwIfAborted(request, {
          addedMessages,
          usedPostCompactAttachments,
        })
        request.toolContext.toolUseIntent = buildToolUseIntent(
          assistantMessage,
          block.id,
          fallbackAssistantIntent,
          latestUserRequest,
        )
        const tool = request.toolRegistry.get(block.name)
        if (!tool) {
          recordTrace(
            request.queryTraceSink,
            'tool.lookup_missing',
            {
              toolUseId: block.id,
              name: block.name,
            },
            iteration,
          )
          toolResultMessages.push(
            createToolResultMessage('user', block.id, {
              error: `Unknown tool: ${block.name}`,
            }),
          )
          continue
        }

        if (!tool.isEnabled(request.toolContext)) {
          recordTrace(
            request.queryTraceSink,
            'tool.disabled',
            {
              toolUseId: block.id,
              name: block.name,
            },
            iteration,
          )
          toolResultMessages.push(
            createToolResultMessage('user', block.id, {
              error: `Tool is disabled: ${block.name}`,
            }),
          )
          continue
        }

        const validation = await tool.validate(block.input, request.toolContext)
        if (!validation.ok) {
          recordTrace(
            request.queryTraceSink,
            'tool.validate.error',
            {
              toolUseId: block.id,
              name: block.name,
              error: validation.error,
            },
            iteration,
          )
          toolResultMessages.push(
            createToolResultMessage('user', block.id, {
              error: validation.error,
            }),
          )
          continue
        }

        recordTrace(
          request.queryTraceSink,
          'tool.validate.ok',
          {
            toolUseId: block.id,
            name: block.name,
          },
          iteration,
        )

        const permission = await evaluateToolPermission(
          tool,
          block.input,
          request.toolContext,
        )
        if (!permission.ok) {
          recordTrace(
            request.queryTraceSink,
            'tool.permission.denied',
            {
              toolUseId: block.id,
              name: block.name,
              error: permission.error,
            },
            iteration,
          )
          toolResultMessages.push(
            createToolResultMessage('user', block.id, {
              error: permission.error,
            }),
          )
          continue
        }

        recordTrace(
          request.queryTraceSink,
          'tool.permission.allowed',
          {
            toolUseId: block.id,
            name: block.name,
          },
          iteration,
        )

        try {
          recordTrace(
            request.queryTraceSink,
            'tool.call.start',
            {
              toolUseId: block.id,
              name: block.name,
              input: block.input,
            },
            iteration,
          )
          const result = await tool.call(block.input, request.toolContext)
          const outputValidation = validateJsonSchema(
            result.output,
            tool.outputSchema,
          )
          if (!outputValidation.ok) {
            const error = `${tool.name} returned output that does not match outputSchema: ${outputValidation.error}`
            const toolResultMessage = createToolResultMessage(
              'user',
              block.id,
              { error },
              result,
            )
            toolResultMessages.push(toolResultMessage)
            recordTrace(
              request.queryTraceSink,
              'tool.output.invalid',
              {
                toolUseId: block.id,
                name: block.name,
                error,
                outputPreview: truncateForTrace(stringifyOutput(result.output)),
              },
              iteration,
            )
            request.streamHandlers?.onToolResult?.({
              iteration,
              toolUseId: block.id,
              output: { error },
            })
            continue
          }
          const mappedResult = tool.mapToolResult(result)
          const toolResultMessage = createToolResultMessage(
            'user',
            block.id,
            mappedResult,
            result,
            result.content,
          )
          toolResultMessages.push(toolResultMessage)
          toolResultMetadata.set(block.id, {
            toolName: tool.name,
            maxResultSizeChars: tool.maxResultSizeChars,
          })
          if (Array.isArray(result.newMessages) && result.newMessages.length > 0) {
            toolGeneratedMessages.push(...result.newMessages)
          }
          recordTrace(
            request.queryTraceSink,
            'tool.call.result',
            {
              toolUseId: block.id,
              name: block.name,
              ok: result.ok,
              summary: result.summary,
              sandboxMode: getSandboxModeFromToolOutput(result.output),
              mappedOutput: mappedResult,
              result: {
                ok: result.ok,
                summary: result.summary,
                output: result.output,
                ...(result.content && result.content.length > 0
                  ? { content: summarizeToolResultContent(result) }
                  : {}),
                ...(result.newMessages && result.newMessages.length > 0
                  ? {
                      newMessages: result.newMessages.map(
                        summarizeMessageForTrace,
                      ),
                    }
                  : {}),
              },
              outputPreview: truncateForTrace(stringifyOutput(result.output)),
            },
            iteration,
          )
          const taskBoardSnapshot =
            request.toolContext.sessionId &&
            shouldEmitTaskBoardSnapshot(tool.name, result)
              ? await loadExecutionTaskBoardForSession(
                  request.toolContext.sessionId,
                )
              : null
          const planModeSnapshot =
            request.toolContext.sessionId &&
            shouldEmitPlanModeSnapshot(tool.name, result)
              ? (await loadSessionMeta(request.toolContext.sessionId))?.planMode
              : null
          request.streamHandlers?.onToolResult?.({
            iteration,
            toolUseId: block.id,
            output: result,
            ...(request.toolContext.sessionId
              ? { sessionId: request.toolContext.sessionId }
              : {}),
            ...(taskBoardSnapshot ? { taskBoard: taskBoardSnapshot } : {}),
            ...(planModeSnapshot ? { planMode: planModeSnapshot } : {}),
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown tool execution error'
          const toolResultMessage = createToolResultMessage('user', block.id, {
            error: message,
          })
          toolResultMessages.push(toolResultMessage)
          recordTrace(
            request.queryTraceSink,
            'tool.call.exception',
            {
              toolUseId: block.id,
              name: block.name,
              error: message,
            },
            iteration,
          )
          request.streamHandlers?.onToolResult?.({
            iteration,
            toolUseId: block.id,
            output: { error: message },
          })
        }
      }

      const budgetedToolResults = await applyToolResultBudget(
        toolResultMessages,
        toolResultMetadata,
        {
          ...(request.toolResultBudgetOptions ?? {}),
          workspaceRoot:
            request.toolResultBudgetOptions?.workspaceRoot ??
            request.toolContext.cwd,
        },
      )
      const recentTools = toolUseBlocks.map(block => {
        const resultMessage = toolResultMessages.find(message => {
          const resultBlock = message.content[0]
          return (
            resultBlock?.type === 'tool_result' &&
            resultBlock.toolUseId === block.id
          )
        })
        const rawOutput =
          resultMessage?.content[0]?.type === 'tool_result'
            ? resultMessage.content[0].rawOutput
            : undefined
        const output =
          resultMessage?.content[0]?.type === 'tool_result'
            ? resultMessage.content[0].output
            : undefined
        const rawObject =
          typeof rawOutput === 'object' && rawOutput !== null
            ? rawOutput as { ok?: unknown; summary?: unknown }
            : undefined

        return {
          name: block.name,
          ok: rawObject?.ok === true || !(
            typeof output === 'object' &&
            output !== null &&
            'error' in output
          ),
          ...(typeof rawObject?.summary === 'string'
            ? { summary: rawObject.summary }
            : {}),
        }
      })
      request.onToolResultsComplete?.({
        iteration,
        tools: recentTools,
      })
      if (budgetedToolResults.replacements.length > 0) {
        recordTrace(
          request.queryTraceSink,
          'iteration.tool_results.persisted',
          {
            count: budgetedToolResults.replacements.length,
            toolUseIds: budgetedToolResults.replacements.map(
              replacement => replacement.toolUseId,
            ),
            toolNames: budgetedToolResults.replacements.map(
              replacement => replacement.toolName,
            ),
            contextStatsAfter: getContextStatsForTrace(request, [
              ...workingMessages,
              ...budgetedToolResults.messages,
            ]),
            compactRecommendationAfter: getCompactRecommendationForTrace(
              request,
              [...workingMessages, ...budgetedToolResults.messages],
            ),
          },
          iteration,
        )
      }

      lastToolResultMessages = budgetedToolResults.messages
      workingMessages.push(...budgetedToolResults.messages)
      addedMessages.push(...budgetedToolResults.messages)
      if (toolGeneratedMessages.length > 0) {
        workingMessages.push(...toolGeneratedMessages)
        addedMessages.push(...toolGeneratedMessages)
      }
      recordTrace(
        request.queryTraceSink,
        'iteration.tool_results',
        {
          count: budgetedToolResults.messages.length,
          generatedMessageCount: toolGeneratedMessages.length,
          contextStatsAfter: getContextStatsForTrace(request, [
            ...workingMessages,
          ]),
          compactRecommendationAfter: getCompactRecommendationForTrace(
            request,
            [...workingMessages],
          ),
          toolUseIds: budgetedToolResults.messages
            .map(message => message.content[0])
            .filter(
              (
                block,
              ): block is {
                type: 'tool_result'
                toolUseId: string
                output: unknown
              } => Boolean(block && block.type === 'tool_result'),
            )
            .map(block => block.toolUseId),
          generatedMessages:
            toolGeneratedMessages.length > 0
              ? toolGeneratedMessages.map(summarizeMessageForTrace)
              : undefined,
        },
        iteration,
      )
      emitCompactDryRun(
        request,
        iteration,
        'post_tool_results',
        workingMessages,
      )
    }

    const fallbackToolText =
      lastToolResultMessages.length > 0
        ? lastToolResultMessages
            .map(message => {
              const block = message.content[0]
              if (!block || block.type !== 'tool_result') {
                return ''
              }
              return stringifyOutput(block.output)
            })
            .filter(text => text.length > 0)
            .join('\n\n')
        : ''

    const maxIterationsMessageText = [
      `Stopped after reaching the maximum iteration limit (${maxIterations}) before the model produced a final answer.`,
      ...(fallbackToolText.length > 0
        ? ['', 'Last tool results:', fallbackToolText]
        : []),
    ].join('\n')
    const maxIterationsMessage = createTextMessage(
      'assistant',
      maxIterationsMessageText,
    )
    addedMessages.push(maxIterationsMessage)

    recordTrace(request.queryTraceSink, 'turn.max_iterations', {
      iterations: maxIterations,
      fallbackToolText: truncateForTrace(fallbackToolText),
      outputText: truncateForTrace(maxIterationsMessageText),
    })

    return {
      assistantMessage: maxIterationsMessage,
      toolResultMessages: lastToolResultMessages,
      addedMessages,
      outputText: maxIterationsMessageText,
      iterations: maxIterations,
      usedPostCompactAttachments,
      turnEndReason: 'max_iterations',
    }
  } finally {
    await request.queryTraceSink?.flush().catch(() => undefined)
  }
}
