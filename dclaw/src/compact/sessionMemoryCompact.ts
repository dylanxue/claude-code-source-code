import { computeContextStats } from '../core/contextStats.js'
import type { Message } from '../types/message.js'

export type SessionMemoryCompactConfig = {
  minTokens: number
  minTextBlockMessages: number
  maxTokens: number
}

export const DEFAULT_SESSION_MEMORY_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 2_000,
  minTextBlockMessages: 3,
  maxTokens: 12_000,
}

function hasTextBlock(message: Message): boolean {
  return message.content.some(block => block.type === 'text')
}

function getToolResultIds(message: Message): string[] {
  return message.content
    .filter((block): block is Extract<Message['content'][number], { type: 'tool_result' }> =>
      block.type === 'tool_result',
    )
    .map(block => block.toolUseId)
}

function getToolUseIds(message: Message): string[] {
  return message.content
    .filter((block): block is Extract<Message['content'][number], { type: 'tool_use' }> =>
      block.type === 'tool_use',
    )
    .map(block => block.id)
}

function estimateMessageTokens(message: Message): number {
  return computeContextStats([message]).approxTokens
}

export function canAdvanceSessionMemoryCheckpoint(messages: Message[]): boolean {
  const lastMessage = messages.at(-1)
  if (!lastMessage) {
    return false
  }

  if (lastMessage.content.some(block => block.type === 'tool_use')) {
    return false
  }

  if (
    lastMessage.role === 'user' &&
    lastMessage.content.length > 0 &&
    lastMessage.content.every(block => block.type === 'tool_result')
  ) {
    return false
  }

  return true
}

export function adjustSessionMemoryStartIndexForApiInvariants(
  messages: Message[],
  startIndex: number,
): number {
  if (startIndex <= 0 || startIndex >= messages.length) {
    return startIndex
  }

  let adjustedIndex = startIndex
  const keptToolUseIds = new Set<string>()
  const neededToolUseIds = new Set<string>()

  for (let index = adjustedIndex; index < messages.length; index += 1) {
    for (const toolUseId of getToolUseIds(messages[index]!)) {
      keptToolUseIds.add(toolUseId)
    }
  }

  for (let index = adjustedIndex; index < messages.length; index += 1) {
    for (const toolResultId of getToolResultIds(messages[index]!)) {
      if (!keptToolUseIds.has(toolResultId)) {
        neededToolUseIds.add(toolResultId)
      }
    }
  }

  for (
    let index = adjustedIndex - 1;
    index >= 0 && neededToolUseIds.size > 0;
    index -= 1
  ) {
    const toolUseIds = getToolUseIds(messages[index]!)
    if (toolUseIds.some(toolUseId => neededToolUseIds.has(toolUseId))) {
      adjustedIndex = index
      for (const toolUseId of toolUseIds) {
        neededToolUseIds.delete(toolUseId)
      }
    }
  }

  const assistantMessageIds = new Set<string>()
  for (let index = adjustedIndex; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role === 'assistant') {
      assistantMessageIds.add(message.id)
    }
  }

  for (let index = adjustedIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (
      message.role === 'assistant' &&
      assistantMessageIds.has(message.id)
    ) {
      adjustedIndex = index
    }
  }

  return adjustedIndex
}

export function calculateSessionMemoryMessagesToKeep(
  messages: Message[],
  coveredMessageId: string,
  config: SessionMemoryCompactConfig = DEFAULT_SESSION_MEMORY_COMPACT_CONFIG,
): {
  messagesToKeep: Message[]
  startIndex: number
  coveredMessageIndex: number
  fallbackReason?: string
} {
  const coveredMessageIndex = messages.findIndex(
    message => message.id === coveredMessageId,
  )
  if (coveredMessageIndex === -1) {
    return {
      messagesToKeep: [],
      startIndex: 0,
      coveredMessageIndex,
      fallbackReason: 'checkpoint_not_found',
    }
  }

  let startIndex = coveredMessageIndex + 1
  let totalTokens = 0
  let textBlockMessageCount = 0

  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index]!
    totalTokens += estimateMessageTokens(message)
    if (hasTextBlock(message)) {
      textBlockMessageCount += 1
    }
  }

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (
      totalTokens >= config.minTokens &&
      textBlockMessageCount >= config.minTextBlockMessages
    ) {
      break
    }

    const message = messages[index]!
    const messageTokens = estimateMessageTokens(message)
    if (totalTokens + messageTokens > config.maxTokens && totalTokens > 0) {
      break
    }

    startIndex = index
    totalTokens += messageTokens
    if (hasTextBlock(message)) {
      textBlockMessageCount += 1
    }
  }

  startIndex = adjustSessionMemoryStartIndexForApiInvariants(
    messages,
    startIndex,
  )

  return {
    messagesToKeep: messages.slice(startIndex),
    startIndex,
    coveredMessageIndex,
  }
}
