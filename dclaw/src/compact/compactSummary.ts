import { createTextMessage, type Message } from '../types/message.js'
import { formatCompactBoundaryLabel } from './types.js'
import type { CompactBoundary } from './types.js'

export type CreateCompactSummaryMessageInput = {
  boundary: Omit<CompactBoundary, 'summaryMessageId'>
  summaryText: string
}

export function buildCompactSummaryText(
  input: CreateCompactSummaryMessageInput,
): string {
  const reasonLine =
    input.boundary.reason && input.boundary.reason.trim().length > 0
      ? [`reason: ${input.boundary.reason.trim()}`]
      : []

  return [
    'Compact summary from earlier in this session.',
    `boundary: ${formatCompactBoundaryLabel(input.boundary)}`,
    `trigger: ${input.boundary.trigger}`,
    `messages compacted: ${input.boundary.messageCountBefore}`,
    ...reasonLine,
    '',
    input.summaryText.trim(),
  ].join('\n')
}

export function createCompactSummaryMessage(
  input: CreateCompactSummaryMessageInput,
): {
  boundary: CompactBoundary
  summaryMessage: Message
} {
  const summaryMessage = createTextMessage(
    'assistant',
    buildCompactSummaryText(input),
  )

  return {
    boundary: {
      ...input.boundary,
      summaryMessageId: summaryMessage.id,
    },
    summaryMessage,
  }
}
