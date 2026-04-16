import {
  createToolUseMessage,
  createTextMessage,
  getTextContent,
  type Message,
} from '../../types/message.js'
import { stringifyJson } from '../providerUtils.js'
import type { CreateMessageRequest, CreateMessageResponse, LlmClient } from '../types.js'

function findLastUserMessage(messages: Message[]): Message | undefined {
  return [...messages].reverse().find(message => message.role === 'user')
}

function getTrailingToolResultOutputs(messages: Message[]): unknown[] {
  const outputs: unknown[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    const toolResultBlocks = message.content.filter(
      block => block.type === 'tool_result',
    )

    if (toolResultBlocks.length === 0) {
      break
    }

    outputs.unshift(...toolResultBlocks.map(block => block.output))
  }

  return outputs
}

function stringifyOutput(value: unknown): string {
  return stringifyJson(value)
}

function tokenizeDirective(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if ((char === '"' || char === "'") && quote === null) {
      quote = char
      continue
    }

    if (char === quote) {
      quote = null
      continue
    }

    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

function parseDirectiveValue(value: string): unknown {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value)
  }
  return value
}

function parseToolDirective(prompt: string): {
  name: string
  input: Record<string, unknown>
} | null {
  const trimmed = prompt.trim()
  if (!trimmed.startsWith('tool:')) {
    return null
  }

  const tokens = tokenizeDirective(trimmed)
  const first = tokens[0]
  const toolName = first?.slice('tool:'.length).trim()
  if (!toolName) {
    return null
  }

  const input: Record<string, unknown> = {}
  for (const token of tokens.slice(1)) {
    const separator = token.indexOf('=')
    if (separator === -1) {
      continue
    }
    const key = token.slice(0, separator)
    const value = token.slice(separator + 1)
    if (key) {
      input[key] = parseDirectiveValue(value)
    }
  }

  return { name: toolName, input }
}

export class StubLlmClient implements LlmClient {
  readonly providerName = 'stub'

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    const trailingToolResultOutputs = getTrailingToolResultOutputs(request.messages)
    if (trailingToolResultOutputs.length > 0) {
      const summary = [
        'dclaw stub final response',
        `tool results: ${trailingToolResultOutputs.length}`,
        ...trailingToolResultOutputs.map((output, index) => {
          return `result ${index + 1}:\n${stringifyOutput(output)}`
        }),
      ].join('\n')

      return {
        message: createTextMessage('assistant', summary),
      }
    }

    const lastUserMessage = findLastUserMessage(request.messages)
    const prompt = lastUserMessage ? getTextContent(lastUserMessage) : ''
    const toolDirective = parseToolDirective(prompt)

    if (toolDirective) {
      return {
        message: createToolUseMessage(
          'assistant',
          toolDirective.name,
          toolDirective.input,
        ),
      }
    }

    const summary = [
      'dclaw stub response',
      `model: ${request.model ?? 'default'}`,
      `system prompt: ${request.systemPrompt ? 'provided' : 'none'}`,
      `system prompt chars: ${request.systemPrompt?.length ?? 0}`,
      `user prompt: ${prompt || '<empty>'}`,
    ].join('\n')

    return {
      message: createTextMessage('assistant', summary),
    }
  }
}
