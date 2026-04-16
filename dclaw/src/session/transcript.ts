import type { Message } from '../types/message.js'

export type FormatTranscriptOptions = {
  includeThinking?: boolean
  maxMessages?: number
}

function truncate(value: string, maxLength: number = 240): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}...`
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function summarizeToolResult(output: unknown): string {
  if (typeof output === 'object' && output !== null) {
    const candidate = output as {
      summary?: unknown
      error?: unknown
      output?: {
        sandboxMode?: unknown
      }
    }
    const sandboxSuffix =
      typeof candidate.output?.sandboxMode === 'string'
        ? ` [sandbox: ${candidate.output.sandboxMode}]`
        : ''
    if (typeof candidate.error === 'string') {
      return candidate.error + sandboxSuffix
    }
    if (typeof candidate.summary === 'string') {
      return candidate.summary + sandboxSuffix
    }
  }

  return truncate(stringifyValue(output))
}

function formatMessage(message: Message, includeThinking: boolean): string[] {
  const lines: string[] = []

  if (message.role === 'user') {
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')

    if (text.length > 0) {
      lines.push(`user: ${truncate(text)}`)
    }

    for (const block of message.content) {
      if (block.type !== 'tool_result') {
        continue
      }
      lines.push(
        `tool result (${block.toolUseId}): ${summarizeToolResult(block.rawOutput ?? block.output)}`,
      )
    }

    return lines.length > 0 ? lines : ['user: [non-text content]']
  }

  if (message.role === 'assistant') {
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const hasOtherContent = message.content.some(block => block.type !== 'text')

    if (text.length > 0) {
      lines.push(`assistant: ${truncate(text)}`)
    } else if (hasOtherContent) {
      lines.push('assistant:')
    } else {
      lines.push('assistant: [empty]')
    }

    for (const block of message.content) {
      switch (block.type) {
        case 'reasoning':
          lines.push(
            `[reasoning] ${
              block.summary.length > 0
                ? truncate(block.summary.join(' '))
                : `status=${block.status ?? 'unknown'}`
            }`,
          )
          break
        case 'thinking':
          if (includeThinking) {
            lines.push(`[thinking] ${truncate(block.thinking)}`)
          }
          break
        case 'redacted_thinking':
          if (includeThinking) {
            lines.push(
              `[redacted thinking] hidden (${block.data.length} chars)`,
            )
          }
          break
        case 'tool_use':
          lines.push(
            `[tool use] ${block.name} ${truncate(stringifyValue(block.input))}`,
          )
          break
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
  return [`system: ${truncate(systemText || '[non-text content]')}`]
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
  if (omittedCount > 0) {
    lines.push(`... ${omittedCount} earlier messages omitted ...`)
    lines.push('')
  }

  visibleMessages.forEach((message, index) => {
    lines.push(...formatMessage(message, includeThinking))
    if (index < visibleMessages.length - 1) {
      lines.push('')
    }
  })

  return lines
}
