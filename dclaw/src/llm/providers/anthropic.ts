import {
  createMessage,
  type ContentBlock,
  type Message,
  type ToolResultContentBlock,
} from '../../types/message.js'
import { resolveModelLimits } from '../modelLimits.js'
import {
  getAnthropicRateLimitResetDelayMs,
  getHttpErrorDetails,
  NonRetryableError,
  readSseEvents,
  RetryableHttpError,
  type SleepImpl,
  stringifyJson,
  withRetry,
  type SseEvent,
} from '../providerUtils.js'
import {
  resolveAnthropicProviderConfig,
  type AnthropicProviderConfig as AnthropicConfig,
} from '../providerConfig.js'
import { resolveModelSelection } from '../modelSelection.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  CreateMessageStreamCallbacks,
  LlmClient,
  LlmToolDefinition,
} from '../types.js'
const ANTHROPIC_VERSION = '2023-06-01'
export {
  resolveAnthropicProviderConfig as resolveAnthropicConfig,
  type AnthropicConfig,
}

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

type AnthropicContentBlock =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'thinking'
      thinking: string
      signature?: string
    }
  | {
      type: 'redacted_thinking'
      data: string
    }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error?: boolean
    }

type AnthropicResponseBlock =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'thinking'
      thinking: string
      signature?: string
    }
  | {
      type: 'redacted_thinking'
      data: string
    }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }

type AnthropicResponse = {
  content?: AnthropicResponseBlock[]
}

type AnthropicStreamEventPayload =
  | {
      index?: number
      content_block?: {
        type?: 'text' | 'tool_use' | 'thinking' | 'redacted_thinking'
        text?: string
        thinking?: string
        signature?: string
        data?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }
    }
  | {
      index?: number
      delta?: {
        type?: string
        text?: string
        thinking?: string
        signature?: string
        partial_json?: string
      }
    }

type StreamingAnthropicBlockState =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'tool_use'
      id?: string
      name?: string
      input: Record<string, unknown>
      partialJson: string
    }
  | {
      type: 'thinking'
      thinking: string
      signature?: string
    }
  | {
      type: 'redacted_thinking'
      data: string
    }

type AnthropicRequestBody = {
  model: string
  max_tokens: number
  system?: string
  messages: AnthropicMessage[]
  tools?: Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
  }>
  stream?: boolean
}

export type AnthropicLlmClientOptions = {
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  maxRetries?: number
  sleepImpl?: SleepImpl
  nowImpl?: () => number
}

function stringifyToolResultOutput(value: unknown): string {
  return stringifyJson(value)
}

function isToolResultError(block: ToolResultContentBlock): boolean {
  const output = block.output
  if (typeof output !== 'object' || output === null) {
    return false
  }

  return typeof (output as { error?: unknown }).error === 'string'
}

function toAnthropicContentBlock(block: ContentBlock): AnthropicContentBlock {
  switch (block.type) {
    case 'text':
      return {
        type: 'text',
        text: block.text,
      }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        ...(block.signature ? { signature: block.signature } : {}),
      }
    case 'redacted_thinking':
      return {
        type: 'redacted_thinking',
        data: block.data,
      }
    case 'reasoning':
      return {
        type: 'text',
        text: block.summary.join('\n'),
      }
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: stringifyToolResultOutput(block.output),
        is_error: isToolResultError(block),
      }
  }
}

function toAnthropicMessage(message: Message): AnthropicMessage {
  if (message.role === 'system') {
    throw new Error('System messages must be sent via systemPrompt')
  }

  return {
    role: message.role,
    content: message.content.map(toAnthropicContentBlock),
  }
}

function toAnthropicTools(
  tools: LlmToolDefinition[] | undefined,
): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

function parseAnthropicContent(
  response: AnthropicResponse,
): ContentBlock[] {
  const blocks = response.content ?? []
  const content: ContentBlock[] = []

  for (const block of blocks) {
    if (!block || typeof block !== 'object' || typeof block.type !== 'string') {
      continue
    }

    switch (block.type) {
      case 'text':
        content.push({ type: 'text', text: block.text })
        break
      case 'thinking':
        content.push({
          type: 'thinking',
          thinking: block.thinking,
          ...(block.signature ? { signature: block.signature } : {}),
        })
        break
      case 'redacted_thinking':
        content.push({
          type: 'redacted_thinking',
          data: block.data,
        })
        break
      case 'tool_use':
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        })
        break
    }
  }

  return content
}

export class AnthropicLlmClient implements LlmClient {
  readonly providerName = 'anthropic'

  private readonly apiKey?: string
  private readonly baseUrl: string
  private readonly defaultModel?: string
  private readonly fetchImpl: typeof fetch
  private readonly env: NodeJS.ProcessEnv
  private readonly maxRetries: number
  private readonly sleepImpl?: SleepImpl
  private readonly nowImpl: () => number

  constructor(options: AnthropicLlmClientOptions = {}) {
    const config = resolveAnthropicProviderConfig(options.env)
    this.apiKey = options.apiKey ?? config.apiKey
    this.baseUrl = options.baseUrl ?? config.baseUrl
    this.defaultModel = options.defaultModel ?? config.defaultModel
    this.fetchImpl = options.fetchImpl ?? fetch
    this.env = options.env ?? process.env
    this.maxRetries = options.maxRetries ?? getMaxRetriesFromEnv(this.env)
    this.sleepImpl = options.sleepImpl
    this.nowImpl = options.nowImpl ?? Date.now
  }

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    const { model, limits } = this.resolveRequestContext(request)
    const parsed = await this.withRetry(async () => {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(
          this.buildRequestBody(request, model, limits.maxOutputTokens),
        ),
      })

      if (!response.ok) {
        throw await this.createRequestError(response)
      }

      return (await response.json()) as AnthropicResponse
    })

    const content = parseAnthropicContent(parsed)
    if (content.length === 0) {
      throw new Error('Anthropic response did not contain supported content blocks')
    }

    return {
      message: createMessage('assistant', content),
    }
  }

  async createMessageStream(
    request: CreateMessageRequest,
    callbacks: CreateMessageStreamCallbacks,
  ): Promise<CreateMessageResponse> {
    const { model, limits } = this.resolveRequestContext(request)
    return this.withRetry(async () => {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          ...this.buildRequestBody(request, model, limits.maxOutputTokens),
          stream: true,
        }),
      })

      if (!response.ok) {
        throw await this.createRequestError(response)
      }

      const blocks: StreamingAnthropicBlockState[] = []
      let sawStreamEvent = false
      try {
        await readSseEvents(response, (event: SseEvent) => {
          if (event.data === '[DONE]') {
            return
          }

          sawStreamEvent = true
          this.applyStreamEvent(blocks, callbacks, event)
        })
      } catch (error) {
        if (sawStreamEvent) {
          throw new NonRetryableError(error)
        }
        throw error
      }

      const content = this.buildStreamingContent(blocks)
      if (content.length === 0) {
        throw new Error('Anthropic streaming response did not contain supported content')
      }

      return {
        message: createMessage('assistant', content),
      }
    })
  }

  private buildRequestBody(
    request: CreateMessageRequest,
    model: string,
    maxTokens: number,
  ): AnthropicRequestBody {
    return {
      model,
      max_tokens: maxTokens,
      system: request.systemPrompt,
      messages: request.messages
        .filter(message => message.role !== 'system')
        .map(toAnthropicMessage),
      tools: toAnthropicTools(request.tools),
    }
  }

  private buildStreamingContent(
    blocks: StreamingAnthropicBlockState[],
  ): ContentBlock[] {
    const content: ContentBlock[] = []

    for (const block of blocks) {
      if (!block) {
        continue
      }

      if (block.type === 'text') {
        if (block.text.length > 0) {
          content.push({
            type: 'text',
            text: block.text,
          })
        }
        continue
      }

      if (block.type === 'thinking') {
        content.push({
          type: 'thinking',
          thinking: block.thinking,
          ...(block.signature ? { signature: block.signature } : {}),
        })
        continue
      }

      if (block.type === 'redacted_thinking') {
        content.push({
          type: 'redacted_thinking',
          data: block.data,
        })
        continue
      }

      if (block.partialJson.length > 0) {
        try {
          const parsed = JSON.parse(block.partialJson)
          if (typeof parsed === 'object' && parsed !== null) {
            block.input = parsed as Record<string, unknown>
          }
        } catch {}
      }

      if (block.id && block.name) {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        })
      }
    }

    return content
  }

  private async createRequestError(response: Response): Promise<RetryableHttpError> {
    const details = await getHttpErrorDetails(response)
    return new RetryableHttpError(
      'Anthropic',
      response.status,
      response.statusText,
      details,
      response.headers,
    )
  }

  private resolveRequestContext(request: CreateMessageRequest): {
    model: string
    limits: ReturnType<typeof resolveModelLimits>
  } {
    if (!this.apiKey) {
      throw new Error(
        'Anthropic API key is required. Set ANTHROPIC_API_KEY or DCLAW_ANTHROPIC_API_KEY, or configure ANTHROPIC_API_KEY in .dclaw/config.json.',
      )
    }

    const { model } = resolveModelSelection(request.model, this.defaultModel)
    if (!model) {
      throw new Error(
        'Anthropic model is required. Pass --model or set ANTHROPIC_MODEL / DCLAW_ANTHROPIC_MODEL.',
      )
    }

    return {
      model,
      limits: resolveModelLimits('anthropic', model, this.env),
    }
  }

  private withRetry<T>(operation: (attempt: number) => Promise<T>): Promise<T> {
    return withRetry(operation, {
      maxRetries: this.maxRetries,
      sleepImpl: this.sleepImpl,
      getDelayMs: error => {
        if (!(error instanceof RetryableHttpError) || error.status !== 429) {
          return undefined
        }

        const resetDelayMs = getAnthropicRateLimitResetDelayMs(
          error.headers,
          this.nowImpl(),
        )
        return resetDelayMs ?? undefined
      },
    })
  }

  private applyStreamEvent(
    blocks: StreamingAnthropicBlockState[],
    callbacks: CreateMessageStreamCallbacks,
    event: SseEvent,
  ): void {
    if (!event.event) {
      return
    }

    const payload = JSON.parse(event.data) as AnthropicStreamEventPayload
    if (event.event === 'content_block_start') {
      const index = payload.index ?? 0
      const contentBlock = 'content_block' in payload ? payload.content_block : undefined
      if (!contentBlock?.type) {
        return
      }

      if (contentBlock.type === 'text') {
        blocks[index] = {
          type: 'text',
          text: contentBlock.text ?? '',
        }
        if (typeof contentBlock.text === 'string' && contentBlock.text.length > 0) {
          callbacks.onTextDelta?.(contentBlock.text)
        }
      }

      if (contentBlock.type === 'tool_use') {
        blocks[index] = {
          type: 'tool_use',
          id: contentBlock.id,
          name: contentBlock.name,
          input: contentBlock.input ?? {},
          partialJson: '',
        }
      }

      if (contentBlock.type === 'thinking') {
        blocks[index] = {
          type: 'thinking',
          thinking: contentBlock.thinking ?? '',
          signature: contentBlock.signature,
        }
        if (
          typeof contentBlock.thinking === 'string' &&
          contentBlock.thinking.length > 0
        ) {
          callbacks.onReasoningDelta?.({
            kind: 'thinking',
            text: contentBlock.thinking,
          })
        }
      }

      if (
        contentBlock.type === 'redacted_thinking' &&
        typeof contentBlock.data === 'string'
      ) {
        blocks[index] = {
          type: 'redacted_thinking',
          data: contentBlock.data,
        }
      }
      return
    }

    if (event.event === 'content_block_delta') {
      const index = payload.index ?? 0
      const delta = 'delta' in payload ? payload.delta : undefined
      const block = blocks[index]
      if (!delta || !block) {
        return
      }

      if (block.type === 'text' && delta.type === 'text_delta' && delta.text) {
        block.text += delta.text
        callbacks.onTextDelta?.(delta.text)
      }

      if (
        block.type === 'thinking' &&
        delta.type === 'thinking_delta' &&
        typeof delta.thinking === 'string'
      ) {
        block.thinking += delta.thinking
        callbacks.onReasoningDelta?.({
          kind: 'thinking',
          text: delta.thinking,
        })
      }

      if (
        block.type === 'thinking' &&
        delta.type === 'signature_delta' &&
        typeof delta.signature === 'string'
      ) {
        block.signature = delta.signature
      }

      if (
        block.type === 'tool_use' &&
        delta.type === 'input_json_delta' &&
        delta.partial_json
      ) {
        block.partialJson += delta.partial_json
      }
    }
  }
}

function getMaxRetriesFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.DCLAW_LLM_MAX_RETRIES
  if (!raw) {
    return 2
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 2
  }

  return Math.floor(parsed)
}
