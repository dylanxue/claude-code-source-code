import { createTextMessage, type Message } from '../types/message.js'
import {
  formatCompactBoundaryLabel,
  type CompactBoundary,
} from './types.js'

export function createCompactBoundaryMessage(
  boundary: CompactBoundary,
): Message {
  const message = createTextMessage(
    'system',
    `<compact-boundary>\n${formatCompactBoundaryLabel(boundary)}\n</compact-boundary>`,
  )
  return {
    ...message,
    compactBoundary: boundary,
  }
}

export function isCompactBoundaryMessage(message: Message): boolean {
  return Boolean(message.compactBoundary)
}

export function findLastCompactBoundaryIndex(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] && isCompactBoundaryMessage(messages[index]!)) {
      return index
    }
  }

  return -1
}

export function getLastCompactBoundary(
  messages: Message[],
): CompactBoundary | undefined {
  const index = findLastCompactBoundaryIndex(messages)
  return index === -1 ? undefined : messages[index]?.compactBoundary
}

export function getCompactBoundaryMessages(messages: Message[]): Message[] {
  return messages.filter(isCompactBoundaryMessage)
}

export function getMessagesAfterCompactBoundary(
  messages: Message[],
  options: {
    includeBoundary?: boolean
  } = {},
): Message[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  if (boundaryIndex === -1) {
    return messages
  }

  return options.includeBoundary
    ? messages.slice(boundaryIndex)
    : messages.slice(boundaryIndex + 1)
}

export function isFreshlyCompactedSession(messages: Message[]): boolean {
  const compactBoundary = getLastCompactBoundary(messages)
  const visibleMessages = getMessagesAfterCompactBoundary(messages)
  if (!compactBoundary || visibleMessages.length !== 1) {
    return false
  }

  return visibleMessages[0]?.id === compactBoundary.summaryMessageId
}
