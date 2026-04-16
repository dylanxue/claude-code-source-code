import {
  createMessage,
  type ContentBlock,
  type Message,
} from '../../types/message.js'
import { resolveModelLimits } from '../modelLimits.js'
import {
  getHttpErrorMessage,
  readSseEvents,
  stringifyJson,
  type SseEvent,
} from '../providerUtils.js'
import {
  resolveOpenAiProviderConfig,
  type OpenAiApiStyle,
  type OpenAiProviderConfig as OpenAiConfig,
} from '../providerConfig.js'
import { resolveModelSelection } from '../modelSelection.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  CreateMessageStreamCallbacks,
  LlmClient,
  LlmToolDefinition,
} from '../types.js'
export {
  resolveOpenAiProviderConfig as resolveOpenAiConfig,
  type OpenAiApiStyle,
  type OpenAiConfig,
}

type OpenAiResponsesInputItem =
  | {
      role: 'user' | 'assistant'
      content: string
    }
  | {
      type: 'reasoning'
      id?: string
      summary?: Array<{
        type: 'summary_text'
        text: string
      }>
      encrypted_content?: string
      status?: string
    }
  | {
      type: 'function_call'
      call_id: string
      name: string
      arguments: string
    }
  | {
      type: 'function_call_output'
      call_id: string
      output: string
    }

type OpenAiResponsesMessageOutputItem = {
  type: 'message'
  role?: 'assistant' | 'user'
  content?: Array<
    | {
        type: 'output_text'
        text: string
      }
    | {
        type: 'input_text'
        text: string
      }
  >
}

type OpenAiResponsesFunctionCallOutputItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type OpenAiResponsesReasoningOutputItem = {
  type: 'reasoning'
  id?: string
  summary?: Array<
    | {
        type?: string
        text?: string
      }
    | string
  >
  encrypted_content?: string
  status?: string
}

type OpenAiResponsesOutputItem = Record<string, unknown>

type OpenAiResponsesResponse = {
  output?: OpenAiResponsesOutputItem[]
  output_text?: string
}

type OpenAiChatMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string
        }
      }>
    }
  | {
      role: 'tool'
      tool_call_id: string
      content: string
    }

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: 'assistant'
      content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
}

type OpenAiChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
}

type OpenAiResponsesStreamEvent = {
  type?: string
  delta?: string
  response?: OpenAiResponsesResponse
  error?: {
    message?: string
  }
}

type StreamingToolCallState = {
  id?: string
  name?: string
  arguments: string
}

export type OpenAiLlmClientOptions = {
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  apiStyle?: OpenAiApiStyle
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

function toResponsesInputItem(
  block: ContentBlock,
  role: 'user' | 'assistant',
): OpenAiResponsesInputItem[] {
  switch (block.type) {
    case 'text':
      return [{ role, content: block.text }]
    case 'thinking':
    case 'redacted_thinking':
      return []
    case 'reasoning':
      return [
        {
          type: 'reasoning',
          ...(block.id ? { id: block.id } : {}),
          ...(block.summary.length > 0
            ? {
                summary: block.summary.map(text => ({
                  type: 'summary_text' as const,
                  text,
                })),
              }
            : {}),
          ...(block.encryptedContent
            ? { encrypted_content: block.encryptedContent }
            : {}),
          ...(block.status ? { status: block.status } : {}),
        },
      ]
    case 'tool_use':
      return [
        {
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      ]
    case 'tool_result':
      return [
        {
          type: 'function_call_output',
          call_id: block.toolUseId,
          output: stringifyJson(block.output),
        },
      ]
  }
}

function toResponsesInput(messages: Message[]): OpenAiResponsesInputItem[] {
  const items: OpenAiResponsesInputItem[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }

    for (const block of message.content) {
      items.push(...toResponsesInputItem(block, message.role))
    }
  }

  return items
}

function toOpenAiTools(
  tools: LlmToolDefinition[] | undefined,
): Array<{
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}> | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  return tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }))
}

function isResponsesMessageOutputItem(
  item: OpenAiResponsesOutputItem,
): item is OpenAiResponsesMessageOutputItem {
  return (
    item.type === 'message' &&
    (item.role === 'assistant' || item.role === 'user' || item.role === undefined)
  )
}

function isResponsesFunctionCallOutputItem(
  item: OpenAiResponsesOutputItem,
): item is OpenAiResponsesFunctionCallOutputItem {
  return (
    item.type === 'function_call' &&
    typeof item.call_id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.arguments === 'string'
  )
}

function isResponsesReasoningOutputItem(
  item: OpenAiResponsesOutputItem,
): item is OpenAiResponsesReasoningOutputItem {
  return item.type === 'reasoning'
}

function parseReasoningSummary(
  summary: OpenAiResponsesReasoningOutputItem['summary'],
): string[] {
  if (!Array.isArray(summary)) {
    return []
  }

  return summary
    .map(part => {
      if (typeof part === 'string') {
        return part
      }
      return typeof part?.text === 'string' ? part.text : ''
    })
    .filter(text => text.length > 0)
}

function parseResponsesResponse(response: OpenAiResponsesResponse): ContentBlock[] {
  const content: ContentBlock[] = []
  let hasTextOutput = false

  for (const item of response.output ?? []) {
    if (isResponsesMessageOutputItem(item) && item.role === 'assistant') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text.length > 0) {
          content.push({
            type: 'text',
            text: part.text,
          })
          hasTextOutput = true
        }
      }
      continue
    }

    if (isResponsesReasoningOutputItem(item)) {
      content.push({
        type: 'reasoning',
        ...(item.id ? { id: item.id } : {}),
        summary: parseReasoningSummary(item.summary),
        ...(typeof item.encrypted_content === 'string'
          ? { encryptedContent: item.encrypted_content }
          : {}),
        ...(typeof item.status === 'string' ? { status: item.status } : {}),
      })
      continue
    }

    if (isResponsesFunctionCallOutputItem(item)) {
      content.push({
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: parseToolArguments(item.arguments),
      })
    }
  }

  if (!hasTextOutput && typeof response.output_text === 'string') {
    content.push({
      type: 'text',
      text: response.output_text,
    })
  }

  return content
}

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
  } catch {}

  return {}
}

function toChatCompletionMessages(
  request: CreateMessageRequest,
): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = []

  if (request.systemPrompt) {
    messages.push({
      role: 'system',
      content: request.systemPrompt,
    })
  }

  for (const message of request.messages) {
    if (message.role === 'system') {
      continue
    }

    const textBlocks = message.content.filter(
      (block): block is Extract<ContentBlock, { type: 'text' }> =>
        block.type === 'text',
    )
    const toolUseBlocks = message.content.filter(
      (block): block is Extract<ContentBlock, { type: 'tool_use' }> =>
        block.type === 'tool_use',
    )
    const toolResultBlocks = message.content.filter(
      (block): block is Extract<ContentBlock, { type: 'tool_result' }> =>
        block.type === 'tool_result',
    )

    if (toolResultBlocks.length > 0) {
      for (const block of toolResultBlocks) {
        messages.push({
          role: 'tool',
          tool_call_id: block.toolUseId,
          content: stringifyJson(block.output),
        })
      }
      continue
    }

    if (message.role === 'user') {
      messages.push({
        role: 'user',
        content: textBlocks.map(block => block.text).join('\n'),
      })
      continue
    }

    messages.push({
      role: 'assistant',
      content: textBlocks.map(block => block.text).join('\n'),
      tool_calls:
        toolUseBlocks.length > 0
          ? toolUseBlocks.map(block => ({
              id: block.id,
              type: 'function' as const,
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            }))
          : undefined,
    })
  }

  return messages
}

function parseChatCompletionResponse(
  response: OpenAiChatCompletionResponse,
): ContentBlock[] {
  const message = response.choices?.[0]?.message
  if (!message) {
    return []
  }

  const content: ContentBlock[] = []
  if (typeof message.content === 'string' && message.content.length > 0) {
    content.push({
      type: 'text',
      text: message.content,
    })
  }

  for (const toolCall of message.tool_calls ?? []) {
    const id = toolCall.id
    const name = toolCall.function?.name
    const argumentsText = toolCall.function?.arguments
    if (!id || !name || typeof argumentsText !== 'string') {
      continue
    }

    content.push({
      type: 'tool_use',
      id,
      name,
      input: parseToolArguments(argumentsText),
    })
  }

  return content
}

function buildChatCompletionContent(
  text: string,
  toolCalls: StreamingToolCallState[],
): ContentBlock[] {
  const content: ContentBlock[] = []

  if (text.length > 0) {
    content.push({
      type: 'text',
      text,
    })
  }

  for (const toolCall of toolCalls) {
    if (!toolCall.id || !toolCall.name) {
      continue
    }

    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: parseToolArguments(toolCall.arguments),
    })
  }

  return content
}

function buildResponsesRequestBody(
  request: CreateMessageRequest,
  model: string,
  maxOutputTokens: number,
  stream: boolean,
): Record<string, unknown> {
  return {
    model,
    instructions: request.systemPrompt,
    input: toResponsesInput(request.messages),
    tools: toOpenAiTools(request.tools),
    max_output_tokens: maxOutputTokens,
    stream,
  }
}

function buildChatCompletionsRequestBody(
  request: CreateMessageRequest,
  model: string,
  maxOutputTokens: number,
  stream: boolean,
): Record<string, unknown> {
  return {
    model,
    messages: toChatCompletionMessages(request),
    tools: request.tools?.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    max_tokens: maxOutputTokens,
    stream,
  }
}

export class OpenAiLlmClient implements LlmClient {
  readonly providerName = 'openai'

  private readonly apiKey?: string
  private readonly baseUrl: string
  private readonly defaultModel?: string
  private readonly apiStyle: OpenAiApiStyle
  private readonly fetchImpl: typeof fetch
  private readonly env: NodeJS.ProcessEnv

  constructor(options: OpenAiLlmClientOptions = {}) {
    const config = resolveOpenAiProviderConfig(options.env)
    this.apiKey = options.apiKey ?? config.apiKey
    this.baseUrl = options.baseUrl ?? config.baseUrl
    this.defaultModel = options.defaultModel ?? config.defaultModel
    this.apiStyle = options.apiStyle ?? config.apiStyle
    this.fetchImpl = options.fetchImpl ?? fetch
    this.env = options.env ?? process.env
  }

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    const { model, limits } = this.resolveRequestContext(request)

    if (this.apiStyle === 'chat-completions') {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey!}`,
        },
        body: JSON.stringify(
          buildChatCompletionsRequestBody(
            request,
            model,
            limits.maxOutputTokens,
            false,
          ),
        ),
      })

      if (!response.ok) {
        const message = await getHttpErrorMessage(response)
        throw new Error(
          `OpenAI request failed (${response.status} ${response.statusText}): ${message}`,
        )
      }

      const parsed = (await response.json()) as OpenAiChatCompletionResponse
      const content = parseChatCompletionResponse(parsed)
      if (content.length === 0) {
        throw new Error('OpenAI response did not contain supported content blocks')
      }

      return {
        message: createMessage('assistant', content),
      }
    }

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey!}`,
      },
      body: JSON.stringify(
        buildResponsesRequestBody(request, model, limits.maxOutputTokens, false),
      ),
    })

    if (!response.ok) {
      const message = await getHttpErrorMessage(response)
      throw new Error(
        `OpenAI request failed (${response.status} ${response.statusText}): ${message}`,
      )
    }

    const parsed = (await response.json()) as OpenAiResponsesResponse
    const content = parseResponsesResponse(parsed)
    if (content.length === 0) {
      throw new Error('OpenAI response did not contain supported content blocks')
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

    if (this.apiStyle !== 'chat-completions') {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey!}`,
        },
        body: JSON.stringify(
          buildResponsesRequestBody(request, model, limits.maxOutputTokens, true),
        ),
      })

      if (!response.ok) {
        const message = await getHttpErrorMessage(response)
        throw new Error(
          `OpenAI request failed (${response.status} ${response.statusText}): ${message}`,
        )
      }

      let text = ''
      let completedResponse: OpenAiResponsesResponse | undefined

      await readSseEvents(response, (event: SseEvent) => {
        if (event.data === '[DONE]') {
          return
        }

        const payload = JSON.parse(event.data) as OpenAiResponsesStreamEvent
        if (payload.type === 'response.output_text.delta' && payload.delta) {
          text += payload.delta
          callbacks.onTextDelta?.(payload.delta)
          return
        }

        if (payload.type === 'response.completed' && payload.response) {
          completedResponse = payload.response
          return
        }

        if (payload.type === 'error' && payload.error?.message) {
          throw new Error(`OpenAI streaming request failed: ${payload.error.message}`)
        }
      })

      const content: ContentBlock[] =
        completedResponse
          ? parseResponsesResponse(completedResponse)
          : text.length > 0
            ? [{ type: 'text', text }]
            : []
      if (content.length === 0) {
        throw new Error('OpenAI streaming response did not contain supported content')
      }

      return {
        message: createMessage('assistant', content),
      }
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey!}`,
      },
      body: JSON.stringify(
        buildChatCompletionsRequestBody(request, model, limits.maxOutputTokens, true),
      ),
    })

    if (!response.ok) {
      const message = await getHttpErrorMessage(response)
      throw new Error(
        `OpenAI request failed (${response.status} ${response.statusText}): ${message}`,
      )
    }

    let text = ''
    const toolCalls: StreamingToolCallState[] = []

    await readSseEvents(response, (event: SseEvent) => {
      if (event.data === '[DONE]') {
        return
      }

      const chunk = JSON.parse(event.data) as OpenAiChatCompletionChunk
      const delta = chunk.choices?.[0]?.delta
      if (!delta) {
        return
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        text += delta.content
        callbacks.onTextDelta?.(delta.content)
      }

      for (const toolCallDelta of delta.tool_calls ?? []) {
        const index = toolCallDelta.index ?? 0
        if (!toolCalls[index]) {
          toolCalls[index] = {
            arguments: '',
          }
        }

        const entry = toolCalls[index]!
        if (toolCallDelta.id) {
          entry.id = toolCallDelta.id
        }
        if (toolCallDelta.function?.name) {
          entry.name = toolCallDelta.function.name
        }
        if (toolCallDelta.function?.arguments) {
          entry.arguments += toolCallDelta.function.arguments
        }
      }
    })

    const content = buildChatCompletionContent(text, toolCalls)
    if (content.length === 0) {
      throw new Error('OpenAI streaming response did not contain supported content')
    }

    return {
      message: createMessage('assistant', content),
    }
  }

  private resolveRequestContext(request: CreateMessageRequest): {
    model: string
    limits: ReturnType<typeof resolveModelLimits>
  } {
    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY or DCLAW_OPENAI_API_KEY.',
      )
    }

    const { model } = resolveModelSelection(request.model, this.defaultModel)
    if (!model) {
      throw new Error(
        'OpenAI model is required. Pass --model or set OPENAI_MODEL / DCLAW_OPENAI_MODEL.',
      )
    }

    return {
      model,
      limits: resolveModelLimits('openai', model, this.env),
    }
  }
}
