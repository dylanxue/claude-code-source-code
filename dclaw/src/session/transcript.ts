import type { Message } from '../types/message.js'
import {
  formatToolUseLine,
  formatToolResultSummaryLine,
} from '../cli/outputFormatting.js'
import {
  formatCompactBoundaryLabel,
} from '../compact/types.js'
import { isCompactBoundaryMessage } from '../compact/boundaryMessage.js'
import {
  describePlanModeToolResult,
  describePlanModeToolUse,
  describeSystemReminderText,
} from '../tasks/observability.js'
import { describePlanSnapshotText } from '../tasks/planSnapshots.js'
import {
  isPersistedToolResultOutput,
} from '../core/toolResultBudget.js'

export type FormatTranscriptOptions = {
  includeThinking?: boolean
  maxMessages?: number
}

function formatImageSummary(count: number): string {
  if (count <= 0) {
    return ''
  }
  return count === 1 ? '[image]' : `[${count} images]`
}

function formatPdfSummary(count: number): string {
  if (count <= 0) {
    return ''
  }
  return count === 1 ? '[pdf]' : `[${count} pdfs]`
}

function truncate(value: string, maxLength: number = 240): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}...`
}

type TranscriptFormatState = {
  toolUses: Map<string, { name: string; input: Record<string, unknown> }>
}

function formatMessage(
  message: Message,
  includeThinking: boolean,
  state: TranscriptFormatState,
): string[] {
  const lines: string[] = []

  if (isCompactBoundaryMessage(message)) {
    return [
      `[compact boundary] ${formatCompactBoundaryLabel(message.compactBoundary!)}`,
    ]
  }

  if (message.role === 'user') {
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const imageCount = message.content.filter(
      block => block.type === 'image',
    ).length
    const pdfCount = message.content.filter(
      block => block.type === 'pdf',
    ).length
    const attachmentSummary = [
      formatImageSummary(imageCount),
      formatPdfSummary(pdfCount),
    ].filter(Boolean).join(' ')

    if (text.length > 0) {
      const reminderText = describeSystemReminderText(text)
      const snapshotText = describePlanSnapshotText(text)
      lines.push(
        snapshotText
          ? snapshotText
          : reminderText
          ? truncate(reminderText)
          : attachmentSummary.length > 0
          ? `user: ${truncate(text)} ${attachmentSummary}`
          : `user: ${truncate(text)}`,
      )
    } else if (attachmentSummary.length > 0) {
      lines.push(`user: ${attachmentSummary}`)
    }

    for (const block of message.content) {
      if (block.type !== 'tool_result') {
        continue
      }
      const toolUse = state.toolUses.get(block.toolUseId)
      const planModeSummary = describePlanModeToolResult(
        toolUse?.name,
        block.output,
        block.rawOutput,
      )
      if (planModeSummary) {
        lines.push(planModeSummary)
        continue
      }
      const displayOutput = isPersistedToolResultOutput(block.output)
        ? block.output
        : block.rawOutput ?? block.output
      lines.push(
        formatToolResultSummaryLine(toolUse, displayOutput),
      )
    }

    return lines.length > 0 ? lines : ['user: [non-text content]']
  }

  if (message.role === 'assistant') {
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const imageCount = message.content.filter(
      block => block.type === 'image',
    ).length
    const pdfCount = message.content.filter(
      block => block.type === 'pdf',
    ).length
    const attachmentSummary = [
      formatImageSummary(imageCount),
      formatPdfSummary(pdfCount),
    ].filter(Boolean).join(' ')
    const hasOtherContent = message.content.some(block => block.type !== 'text')

    if (text.length > 0) {
      lines.push(
        attachmentSummary.length > 0
          ? `assistant: ${truncate(text)} ${attachmentSummary}`
          : `assistant: ${truncate(text)}`,
      )
    } else if (attachmentSummary.length > 0) {
      lines.push(`assistant: ${attachmentSummary}`)
    } else if (hasOtherContent) {
      lines.push('assistant:')
    } else {
      lines.push('assistant: [empty]')
    }

    for (const block of message.content) {
      switch (block.type) {
        case 'reasoning':
          lines.push(
            `Reasoning: ${
              block.summary.length > 0
                ? truncate(block.summary.join(' '))
                : `status=${block.status ?? 'unknown'}`
            }`,
          )
          break
        case 'thinking':
          if (includeThinking) {
            lines.push(`Thinking: ${truncate(block.thinking)}`)
          }
          break
        case 'redacted_thinking':
          if (includeThinking) {
            lines.push(
              `Thinking: [hidden (${block.data.length} chars)]`,
            )
          }
          break
        case 'tool_use':
          state.toolUses.set(block.id, {
            name: block.name,
            input: block.input,
          })
          const planModeSummary = describePlanModeToolUse(block.name, block.input)
          if (planModeSummary) {
            lines.push(planModeSummary)
            break
          }
          lines.push(
            formatToolUseLine({
              name: block.name,
              input: block.input,
            }),
          )
          break
        case 'image':
        case 'pdf':
        case 'text':
        case 'tool_result':
          break
      }
    }

    return lines
  }

  const systemText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  const snapshotText = describePlanSnapshotText(systemText)
  return [
    snapshotText
      ? snapshotText
      : `system: ${truncate(systemText || '[non-text content]')}`,
  ]
}

export function formatTranscript(
  messages: Message[],
  options: FormatTranscriptOptions = {},
): string[] {
  const includeThinking = options.includeThinking ?? false
  const maxMessages = options.maxMessages
  const visibleMessages =
    typeof maxMessages === 'number' && maxMessages > 0
      ? messages.slice(-maxMessages)
      : messages
  const omittedCount = messages.length - visibleMessages.length

  const lines: string[] = []
  const state: TranscriptFormatState = {
    toolUses: new Map(),
  }
  if (omittedCount > 0) {
    lines.push(`... ${omittedCount} earlier messages omitted ...`)
    lines.push('')
  }

  visibleMessages.forEach((message, index) => {
    lines.push(...formatMessage(message, includeThinking, state))
    if (index < visibleMessages.length - 1) {
      lines.push('')
    }
  })

  return lines
}
