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
  getTextContent,
  getToolUseBlocks,
  type ContentBlock,
  type Message,
} from '../types/message.js'
import type { ToolContext } from '../types/tool.js'
import { evaluateToolPermission } from '../permissions/evaluator.js'
import type { ToolRegistry } from '../tools/registry.js'
import { validateJsonSchema } from '../tools/schema.js'
import type { Tool } from '../tools/types.js'
import {
  applyToolResultBudget,
  type ToolResultBudgetMetadata,
  type ToolResultBudgetOptions,
} from './toolResultBudget.js'
import { QueryLoopLlmError } from './queryErrors.js'
import type { QueryTraceSink } from './queryTrace.js'

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
}

export const DEFAULT_QUERY_MAX_ITERATIONS = 128

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
  const messages = resolved?.messages ?? workingMessages
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
  const maxIterations = request.maxIterations ?? DEFAULT_QUERY_MAX_ITERATIONS
  const workingMessages = [...request.messages]
  const addedMessages: Message[] = []
  let lastAssistantMessage: Message | undefined
  let lastToolResultMessages: Message[] = []
  let outputText = ''
  let usedPostCompactAttachments = false
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
      const iterationState =
        iteration === 1
          ? initialIterationState
          : await resolveIterationState(request, workingMessages)
      if (iteration > 1) {
        usedPostCompactAttachments ||= iterationState.usedPostCompactAttachments
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
      let lastTextDelta: string | undefined
      let lastReasoningDelta:
        | {
            kind: 'reasoning' | 'thinking'
            text: string
          }
        | undefined
      recordTrace(
        request.queryTraceSink,
        'llm.request',
        {
          model: request.model ?? 'default',
          streaming: useStreaming,
          systemPrompt: iterationState.systemPrompt,
          messageCount: iterationState.messages.length,
          messages: iterationState.messages,
          toolNames: iterationState.toolDefinitions.map(tool => tool.name),
        },
        iteration,
      )

      let streamedResponse
      try {
        streamedResponse =
          useStreaming
            ? await request.client.createMessageStream!.call(
                request.client,
                {
                  model: request.model,
                  systemPrompt: iterationState.systemPrompt,
                  messages: iterationState.messages,
                  tools: iterationState.toolDefinitions,
                },
                {
                  onTextDelta: text => {
                    streamedTextChars += text.length
                    lastTextDelta = text
                    recordTrace(
                      request.queryTraceSink,
                      'llm.text.delta',
                      { text },
                      iteration,
                    )
                    request.streamHandlers?.onTextDelta?.(text)
                  },
                  onReasoningDelta: delta => {
                    streamedReasoningChars += delta.text.length
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
                  },
                },
              )
            : await request.client.createMessage({
                model: request.model,
                systemPrompt: iterationState.systemPrompt,
                messages: iterationState.messages,
                tools: iterationState.toolDefinitions,
              })
      } catch (error) {
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
      if (toolUseBlocks.length === 0) {
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
        }
      }

      const toolResultMessages: Message[] = []
      const toolResultMetadata = new Map<string, ToolResultBudgetMetadata>()
      for (const block of toolUseBlocks) {
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
          )
          toolResultMessages.push(toolResultMessage)
          toolResultMetadata.set(block.id, {
            toolName: tool.name,
            maxResultSizeChars: tool.maxResultSizeChars,
          })
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
              result,
              outputPreview: truncateForTrace(stringifyOutput(result.output)),
            },
            iteration,
          )
          request.streamHandlers?.onToolResult?.({
            iteration,
            toolUseId: block.id,
            output: result,
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
        request.toolResultBudgetOptions,
      )
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
      recordTrace(
        request.queryTraceSink,
        'iteration.tool_results',
        {
          count: budgetedToolResults.messages.length,
          contextStatsAfter: getContextStatsForTrace(request, [
            ...workingMessages,
            ...budgetedToolResults.messages,
          ]),
          compactRecommendationAfter: getCompactRecommendationForTrace(
            request,
            [...workingMessages, ...budgetedToolResults.messages],
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
    }
  } finally {
    await request.queryTraceSink?.flush().catch(() => undefined)
  }
}
