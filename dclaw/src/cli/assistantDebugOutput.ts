import type { Message } from '../types/message.js'

function truncate(value: string, maxLength: number = 240): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}...`
}

function stringifyToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input)
  } catch {
    return '{}'
  }
}

export function formatAssistantDebugOutput(messages: Message[]): string[] {
  const assistantMessages = messages.filter(message => message.role === 'assistant')
  const details: string[] = []

  for (const [index, message] of assistantMessages.entries()) {
    const blockLines: string[] = []
    const hasDebugBlocks = message.content.some(
      block =>
        block.type === 'reasoning' ||
        block.type === 'thinking' ||
        block.type === 'redacted_thinking' ||
        block.type === 'tool_use',
    )

    for (const block of message.content) {
      switch (block.type) {
        case 'reasoning': {
          const summary =
            block.summary.length > 0
              ? truncate(block.summary.join(' '))
              : `status=${block.status ?? 'unknown'}`
          blockLines.push(`[reasoning] ${summary}`)
          break
        }
        case 'thinking':
          blockLines.push(`[thinking] ${truncate(block.thinking)}`)
          break
        case 'redacted_thinking':
          blockLines.push(
            `[redacted thinking] hidden (${block.data.length} chars)`,
          )
          break
        case 'tool_use':
          blockLines.push(
            `[tool use] ${block.name} ${truncate(stringifyToolInput(block.input))}`,
          )
          break
        case 'text':
          if (hasDebugBlocks && block.text.length > 0) {
            blockLines.push(`[assistant text] ${truncate(block.text)}`)
          }
          break
        case 'tool_result':
          break
      }
    }

    if (blockLines.length === 0) {
      continue
    }

    if (assistantMessages.length > 1) {
      details.push(`assistant message ${index + 1}:`)
    } else {
      details.push('assistant message:')
    }
    details.push(...blockLines)
  }

  return details
}
