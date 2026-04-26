import type { ModelLimits } from '../llm/modelLimits.js'
import type { ContentBlock, Message } from '../types/message.js'
import {
  isPersistedToolResultOutput,
  resolveToolResultBudgetOptions,
  type ToolResultBudgetOptions,
} from './toolResultBudget.js'

const APPROX_CHARS_PER_TOKEN = 4

export type ContextStats = {
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  systemMessageCount: number
  toolUseCount: number
  toolResultCount: number
  persistedToolResultCount: number
  approxChars: number
  approxTokens: number
  modelContextWindow?: number
  modelMaxOutputTokens?: number
  estimatedInputBudgetTokens?: number
  estimatedInputBudgetChars?: number
  contextUsageRatio?: number
  toolResultBudget?: {
    defaultMaxResultSizeChars: number
    maxToolResultsPerTurnChars: number
    previewChars: number
  }
}

export type ComputeContextStatsOptions = {
  modelLimits?: ModelLimits
  toolResultBudgetOptions?: ToolResultBudgetOptions
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getBlockApproxChars(block: ContentBlock): number {
  switch (block.type) {
    case 'text':
      return block.text.length
    case 'image':
      return block.source.mediaType.length + block.source.data.length
    case 'pdf':
      return block.source.mediaType.length +
        block.source.data.length +
        (block.filename?.length ?? 0)
    case 'thinking':
      return block.thinking.length
    case 'redacted_thinking':
      return block.data.length
    case 'reasoning':
      return (
        block.summary.join('\n').length + (block.encryptedContent?.length ?? 0)
      )
    case 'tool_use':
      return block.name.length + stringifyValue(block.input).length
    case 'tool_result':
      return block.content && block.content.length > 0
        ? block.content.reduce(
            (total, item) =>
              total +
              (item.type === 'text'
                ? item.text.length
                : item.source.mediaType.length +
                  item.source.data.length +
                  (item.type === 'pdf' ? (item.filename?.length ?? 0) : 0)),
            0,
          )
        : stringifyValue(block.output).length
  }
}

export function computeContextStats(
  messages: Message[],
  options: ComputeContextStatsOptions = {},
): ContextStats {
  let userMessageCount = 0
  let assistantMessageCount = 0
  let systemMessageCount = 0
  let toolUseCount = 0
  let toolResultCount = 0
  let persistedToolResultCount = 0
  let approxChars = 0

  for (const message of messages) {
    if (message.role === 'user') {
      userMessageCount += 1
    } else if (message.role === 'assistant') {
      assistantMessageCount += 1
    } else {
      systemMessageCount += 1
    }

    for (const block of message.content) {
      approxChars += getBlockApproxChars(block)

      if (block.type === 'tool_use') {
        toolUseCount += 1
      }
      if (block.type === 'tool_result') {
        toolResultCount += 1
        if (isPersistedToolResultOutput(block.output)) {
          persistedToolResultCount += 1
        }
      }
    }
  }

  const approxTokens = Math.ceil(approxChars / APPROX_CHARS_PER_TOKEN)
  const estimatedInputBudgetTokens = options.modelLimits
    ? Math.max(256, options.modelLimits.contextWindow - options.modelLimits.maxOutputTokens)
    : undefined
  const estimatedInputBudgetChars =
    estimatedInputBudgetTokens === undefined
      ? undefined
      : estimatedInputBudgetTokens * APPROX_CHARS_PER_TOKEN
  const contextUsageRatio =
    estimatedInputBudgetTokens && estimatedInputBudgetTokens > 0
      ? approxTokens / estimatedInputBudgetTokens
      : undefined
  const resolvedBudget = options.toolResultBudgetOptions
    ? resolveToolResultBudgetOptions(options.toolResultBudgetOptions)
    : undefined

  return {
    messageCount: messages.length,
    userMessageCount,
    assistantMessageCount,
    systemMessageCount,
    toolUseCount,
    toolResultCount,
    persistedToolResultCount,
    approxChars,
    approxTokens,
    ...(options.modelLimits
      ? {
          modelContextWindow: options.modelLimits.contextWindow,
          modelMaxOutputTokens: options.modelLimits.maxOutputTokens,
        }
      : {}),
    ...(estimatedInputBudgetTokens === undefined
      ? {}
      : {
          estimatedInputBudgetTokens,
          estimatedInputBudgetChars,
          contextUsageRatio,
        }),
    ...(resolvedBudget
      ? {
          toolResultBudget: {
            defaultMaxResultSizeChars:
              resolvedBudget.defaultMaxResultSizeChars,
            maxToolResultsPerTurnChars:
              resolvedBudget.maxToolResultsPerTurnChars,
            previewChars: resolvedBudget.previewChars,
          },
        }
      : {}),
  }
}

export function formatContextStatsLines(stats: ContextStats): string[] {
  const usageLine =
    typeof stats.contextUsageRatio === 'number'
      ? `estimated context usage: ${(stats.contextUsageRatio * 100).toFixed(1)}%`
      : undefined

  return [
    `messages: ${stats.messageCount} (user ${stats.userMessageCount}, assistant ${stats.assistantMessageCount}, system ${stats.systemMessageCount})`,
    `tool blocks: uses ${stats.toolUseCount}, results ${stats.toolResultCount}, persisted ${stats.persistedToolResultCount}`,
    `approx context: ${stats.approxChars} chars / ${stats.approxTokens} tokens`,
    ...(usageLine ? [usageLine] : []),
  ]
}
