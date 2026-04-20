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

function parseMemorySelectorQuery(prompt: string): string {
  return prompt.match(/^Query:\s*([\s\S]*?)\n\nAvailable memories:/)?.[1]?.trim() ?? ''
}

function parseMemorySelectorManifest(
  prompt: string,
): Array<{ relativePath: string; haystack: string }> {
  const manifestSection = prompt.split('Available memories:\n')[1]?.split('\n\nReturn JSON only.')[0]
  if (!manifestSection) {
    return []
  }

  return manifestSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => {
      const relativePath =
        line.match(/^\-\s+\[[^\]]+\]\s+([^|]+)\s+\|/)?.[1]?.trim()
      return relativePath
        ? {
            relativePath,
            haystack: line.toLowerCase(),
          }
        : null
    })
    .filter(
      (
        value,
      ): value is {
        relativePath: string
        haystack: string
      } => value !== null,
    )
}

function tokenizeMemorySelectorQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(token => token.length >= 1)
}

function buildMemorySelectorResponse(prompt: string): string {
  const query = parseMemorySelectorQuery(prompt)
  const manifest = parseMemorySelectorManifest(prompt)
  const queryTokens = tokenizeMemorySelectorQuery(query)

  const selected = manifest
    .map(entry => ({
      ...entry,
      score: queryTokens.filter(token => entry.haystack.includes(token)).length,
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(entry => entry.relativePath)

  return JSON.stringify({ selected_memories: selected })
}

export class StubLlmClient implements LlmClient {
  readonly providerName = 'stub'

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    if (request.systemPrompt?.includes('You are generating a compact summary')) {
      const lastUserMessage = findLastUserMessage(request.messages)
      const prompt = lastUserMessage ? getTextContent(lastUserMessage) : ''
      const transcriptSection =
        prompt.split('## Transcript\n')[1]?.trim() ?? '<empty>'
      const transcriptPreview = transcriptSection
        .split('\n')
        .slice(0, 6)
        .join('\n')

      return {
        message: createTextMessage(
          'assistant',
          [
            '<summary>',
            'Primary request: continue the current session with a compacted summary.',
            'Current work: preserve the latest technical context and constraints.',
            'Transcript evidence:',
            transcriptPreview,
            '</summary>',
          ].join('\n'),
        ),
      }
    }

    if (
      request.systemPrompt?.includes(
        'You are selecting memories that will be useful to dclaw as it processes a user query.',
      )
    ) {
      const lastUserMessage = findLastUserMessage(request.messages)
      const prompt = lastUserMessage ? getTextContent(lastUserMessage) : ''
      return {
        message: createTextMessage(
          'assistant',
          buildMemorySelectorResponse(prompt),
        ),
      }
    }

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
