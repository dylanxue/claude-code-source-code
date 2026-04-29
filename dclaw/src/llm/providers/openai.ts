import {
  createMessage,
  type ContentBlock,
  type ImageContentBlock,
  type Message,
  type PdfContentBlock,
  type TextAnnotation,
} from '../../types/message.js'
import {
  validateImagesForProvider,
} from '../imageValidation.js'
import { resolveModelLimits } from '../modelLimits.js'
import {
  getLlmMaxRetries,
  getLlmRequestTimeoutMs,
  getHttpErrorDetails,
  getStreamIdleTimeoutMs,
  isStreamWatchdogEnabled,
  NonRetryableError,
  parseSseTextEvents,
  readSseEvents,
  RetryableHttpError,
  type SleepImpl,
  stringifyJson,
  withTimeout,
  withRetry,
  type SseEvent,
} from '../providerUtils.js'
import {
  type OpenAiProviderConfig as OpenAiConfig,
} from '../providerConfig.js'
import type { ModelCatalogOverrides, OpenAiApiStyle } from '../config.js'
import { resolveModelSelection } from '../modelSelection.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  CreateMessageStreamCallbacks,
  LlmClient,
  LlmToolDefinition,
  OpenAiReasoningEffort,
  OpenAiResponsesRequestOptions,
  OpenAiTextVerbosity,
} from '../types.js'
export { type OpenAiApiStyle, type OpenAiConfig }

type OpenAiResponsesMessageInputContent =
  | {
      type: 'input_text'
      text: string
    }
  | {
      type: 'input_image'
      image_url: string
    }
  | {
      type: 'input_file'
      filename?: string
      file_data: string
    }

type OpenAiResponsesInputItem =
  | {
      role: 'user' | 'assistant'
      content: string | OpenAiResponsesMessageInputContent[]
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
        annotations?: OpenAiResponsesAnnotation[]
      }
    | {
        type: 'refusal'
        refusal: string
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

type OpenAiResponsesOutputTextPart = {
  type?: string
  text?: string
  refusal?: string
  annotations?: OpenAiResponsesAnnotation[]
}

type OpenAiResponsesAnnotation = {
  type?: string
  start_index?: number
  end_index?: number
  title?: string
  url?: string
  file_id?: string
  filename?: string
} & Record<string, unknown>

type OpenAiResponsesFunctionCallItem = {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
}

type OpenAiResponsesReasoningItem = {
  type?: string
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

type OpenAiResponsesMessageItem = {
  type?: string
  role?: string
  content?: Array<OpenAiResponsesOutputTextPart>
}

type OpenAiChatMessage =
  | {
      role: 'system' | 'assistant'
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
      role: 'user'
      content: string | OpenAiChatContentPart[]
    }
  | {
      role: 'tool'
      tool_call_id: string
      content: string
    }

type OpenAiChatContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_url'
      image_url: {
        url: string
      }
    }
  | {
      type: 'file'
      file: {
        filename?: string
        file_data: string
      }
    }

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: 'assistant'
      content?: string | null
      reasoning_content?: string | null
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
      reasoning_content?: string
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
  text?: string
  refusal?: string
  annotation?: OpenAiResponsesAnnotation
  arguments?: string
  item?: OpenAiResponsesOutputItem
  part?: {
    type?: string
    text?: string
    refusal?: string
    annotations?: OpenAiResponsesAnnotation[]
  }
  item_id?: string
  output_index?: number
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

type StreamingReasoningState = {
  id?: string
  summary: string
  encryptedContent?: string
  status?: string
}

type StreamingResponsesState = {
  textByOutputIndex: Map<number, string>
  annotationsByOutputIndex: Map<number, TextAnnotation[]>
  reasoningByOutputIndex: Map<number, StreamingReasoningState>
  toolCallsByOutputIndex: Map<number, StreamingToolCallState>
  lastTextAppendByOutputIndex: Map<
    number,
    {
      source: 'output_text' | 'content_part' | 'refusal'
      text: string
    }
  >
  outputOrder: number[]
}

export type OpenAiLlmClientOptions = {
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  apiStyle?: OpenAiApiStyle
  modelCatalogOverrides?: ModelCatalogOverrides
  defaultTextVerbosity?: OpenAiTextVerbosity
  defaultReasoningEffort?: OpenAiReasoningEffort
  defaultStore?: boolean
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  maxRetries?: number
  requestTimeoutMs?: number
  sleepImpl?: SleepImpl
  streamWatchdogEnabled?: boolean
  streamIdleTimeoutMs?: number
}

type ResolvedOpenAiResponsesOptions = {
  verbosity?: OpenAiTextVerbosity
  reasoningEffort?: OpenAiReasoningEffort
  previousResponseId?: string
  store?: boolean
  parallelToolCalls?: boolean
  maxToolCalls?: number
  include?: string[]
  truncation?: 'auto' | 'disabled'
  metadata?: Record<string, string>
  textFormat?: Record<string, unknown>
}

function toResponsesImageUrl(block: ImageContentBlock): string {
  return `data:${block.source.mediaType};base64,${block.source.data}`
}

function toResponsesPdfFileData(block: PdfContentBlock): string {
  return `data:${block.source.mediaType};base64,${block.source.data}`
}

function stringifyToolResultForOpenAi(output: unknown): string {
  return stringifyJson(output)
}

function toResponsesMessageContent(
  block: Extract<ContentBlock, { type: 'text' | 'image' | 'pdf' }>,
): OpenAiResponsesMessageInputContent {
  if (block.type === 'text') {
    return {
      type: 'input_text',
      text: block.text,
    }
  }

  if (block.type === 'pdf') {
    return {
      type: 'input_file',
      ...(block.filename ? { filename: block.filename } : {}),
      file_data: toResponsesPdfFileData(block),
    }
  }

  return {
    type: 'input_image',
    image_url: toResponsesImageUrl(block),
  }
}

function toChatCompletionContentPart(
  block: Extract<ContentBlock, { type: 'text' | 'image' | 'pdf' }>,
): OpenAiChatContentPart {
  if (block.type === 'text') {
    return {
      type: 'text',
      text: block.text,
    }
  }

  if (block.type === 'pdf') {
    return {
      type: 'file',
      file: {
        ...(block.filename ? { filename: block.filename } : {}),
        file_data: toResponsesPdfFileData(block),
      },
    }
  }

  return {
    type: 'image_url',
    image_url: {
      url: toResponsesImageUrl(block),
    },
  }
}

function toResponsesInput(messages: Message[]): OpenAiResponsesInputItem[] {
  const items: OpenAiResponsesInputItem[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }
    const role: 'user' | 'assistant' = message.role

    let messageContent: Array<Extract<ContentBlock, { type: 'text' | 'image' | 'pdf' }>> = []

    const flushMessageContent = (): void => {
      if (messageContent.length === 0) {
        return
      }

      const hasNonTextAttachment = messageContent.some(
        block => block.type === 'image' || block.type === 'pdf',
      )
      if (message.role === 'assistant' && hasNonTextAttachment) {
        throw new Error(
          'OpenAI attachment blocks are only supported on user messages in dclaw',
        )
      }

      if (
        !hasNonTextAttachment &&
        messageContent.length === 1 &&
        messageContent[0]?.type === 'text'
      ) {
        items.push({
          role,
          content: messageContent[0].text,
        })
      } else {
        items.push({
          role,
          content: messageContent.map(toResponsesMessageContent),
        })
      }

      messageContent = []
    }

    for (const block of message.content) {
      switch (block.type) {
        case 'text':
        case 'image':
        case 'pdf':
          messageContent.push(block)
          break
        case 'thinking':
        case 'redacted_thinking':
          break
        case 'reasoning':
          flushMessageContent()
          items.push({
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
          })
          break
        case 'tool_use':
          flushMessageContent()
          items.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          })
          break
        case 'tool_result':
          flushMessageContent()
          items.push({
            type: 'function_call_output',
            call_id: block.toolUseId,
            output: stringifyToolResultForOpenAi(block.output),
          })
          break
      }
    }

    flushMessageContent()
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

function stripStoredResponseIdsWhenStoreIsFalse(
  items: OpenAiResponsesInputItem[],
): OpenAiResponsesInputItem[] {
  return items.map(item => {
    if (
      'type' in item &&
      item.type === 'reasoning' &&
      typeof item.encrypted_content === 'string'
    ) {
      return {
        type: item.type,
        ...(item.summary ? { summary: item.summary } : {}),
        encrypted_content: item.encrypted_content,
        ...(item.status ? { status: item.status } : {}),
      }
    }
    return item
  })
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
    (typeof item.call_id === 'string' || typeof item.id === 'string') &&
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

function normalizeAnnotation(
  annotation: OpenAiResponsesAnnotation,
): TextAnnotation {
  return {
    ...(typeof annotation.type === 'string' ? { type: annotation.type } : {}),
    ...(typeof annotation.start_index === 'number'
      ? { startIndex: annotation.start_index }
      : {}),
    ...(typeof annotation.end_index === 'number'
      ? { endIndex: annotation.end_index }
      : {}),
    ...(typeof annotation.title === 'string' ? { title: annotation.title } : {}),
    ...(typeof annotation.url === 'string' ? { url: annotation.url } : {}),
    ...(typeof annotation.file_id === 'string' ? { fileId: annotation.file_id } : {}),
    ...(typeof annotation.filename === 'string'
      ? { filename: annotation.filename }
      : {}),
    raw: annotation,
  }
}

function getMessageItemAnnotations(
  item: OpenAiResponsesMessageOutputItem | OpenAiResponsesMessageItem,
): TextAnnotation[] | undefined {
  const annotations = (item.content ?? [])
    .flatMap(part => {
      if (
        !('annotations' in part) ||
        !Array.isArray(part.annotations) ||
        part.annotations.length === 0
      ) {
        return []
      }
      return part.annotations.map(normalizeAnnotation)
    })

  return annotations.length > 0 ? annotations : undefined
}

function getMessageItemText(
  item: OpenAiResponsesMessageOutputItem | OpenAiResponsesMessageItem,
): string {
  return (item.content ?? [])
    .map(part => {
      if (part.type === 'output_text' && typeof part.text === 'string') {
        return part.text
      }

      if (part.type === 'refusal' && typeof part.refusal === 'string') {
        return part.refusal
      }

      return ''
    })
    .join('')
}

function parseResponsesResponse(response: OpenAiResponsesResponse): ContentBlock[] {
  const content: ContentBlock[] = []
  let hasTextOutput = false

  for (const item of response.output ?? []) {
    if (isResponsesMessageOutputItem(item) && item.role === 'assistant') {
      for (const part of item.content ?? []) {
      if (
        part.type === 'output_text' &&
        typeof part.text === 'string' &&
        part.text.length > 0
      ) {
          content.push({
            type: 'text',
            text: part.text,
            ...(Array.isArray(part.annotations) && part.annotations.length > 0
              ? { annotations: part.annotations.map(normalizeAnnotation) }
              : {}),
          })
          hasTextOutput = true
          continue
        }

        if (
          part.type === 'refusal' &&
          typeof part.refusal === 'string' &&
          part.refusal.length > 0
        ) {
          content.push({
            type: 'text',
            text: part.refusal,
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

function getOutputIndex(event: OpenAiResponsesStreamEvent): number | undefined {
  return typeof event.output_index === 'number' ? event.output_index : undefined
}

function ensureOutputOrder(state: StreamingResponsesState, outputIndex: number): void {
  if (!state.outputOrder.includes(outputIndex)) {
    state.outputOrder.push(outputIndex)
  }
}

function appendStreamingTextDelta(
  state: StreamingResponsesState,
  outputIndex: number,
  source: 'output_text' | 'content_part' | 'refusal',
  text: string,
): boolean {
  const lastAppend = state.lastTextAppendByOutputIndex.get(outputIndex)
  if (
    lastAppend &&
    lastAppend.source !== source &&
    lastAppend.text === text
  ) {
    state.lastTextAppendByOutputIndex.set(outputIndex, {
      source,
      text,
    })
    return false
  }

  const current = state.textByOutputIndex.get(outputIndex) ?? ''
  state.textByOutputIndex.set(outputIndex, current + text)
  state.lastTextAppendByOutputIndex.set(outputIndex, {
    source,
    text,
  })
  ensureOutputOrder(state, outputIndex)
  return true
}

function getOrCreateReasoningState(
  state: StreamingResponsesState,
  outputIndex: number,
): StreamingReasoningState {
  const existing = state.reasoningByOutputIndex.get(outputIndex)
  if (existing) {
    return existing
  }

  const created: StreamingReasoningState = {
    summary: '',
  }
  state.reasoningByOutputIndex.set(outputIndex, created)
  ensureOutputOrder(state, outputIndex)
  return created
}

function getOrCreateToolCallState(
  state: StreamingResponsesState,
  outputIndex: number,
): StreamingToolCallState {
  const existing = state.toolCallsByOutputIndex.get(outputIndex)
  if (existing) {
    return existing
  }

  const created: StreamingToolCallState = {
    arguments: '',
  }
  state.toolCallsByOutputIndex.set(outputIndex, created)
  ensureOutputOrder(state, outputIndex)
  return created
}

function applyResponsesMessageItem(
  state: StreamingResponsesState,
  outputIndex: number,
  item: OpenAiResponsesMessageOutputItem | OpenAiResponsesMessageItem,
): void {
  const text = getMessageItemText(item)
  const annotations = getMessageItemAnnotations(item)

  if (text && text.length > 0) {
    state.textByOutputIndex.set(outputIndex, text)
    if (annotations) {
      state.annotationsByOutputIndex.set(outputIndex, annotations)
    }
    ensureOutputOrder(state, outputIndex)
  }
}

function applyResponsesReasoningItem(
  state: StreamingResponsesState,
  outputIndex: number,
  item: OpenAiResponsesReasoningItem,
): void {
  const reasoning = getOrCreateReasoningState(state, outputIndex)
  if (typeof item.id === 'string') {
    reasoning.id = item.id
  }
  if (typeof item.encrypted_content === 'string') {
    reasoning.encryptedContent = item.encrypted_content
  }
  if (typeof item.status === 'string') {
    reasoning.status = item.status
  }

  const summary = parseReasoningSummary(item.summary)
  if (summary.length > 0) {
    reasoning.summary = summary.join('')
  }
}

function applyResponsesFunctionCallItem(
  state: StreamingResponsesState,
  outputIndex: number,
  item: OpenAiResponsesFunctionCallItem,
): void {
  const toolCall = getOrCreateToolCallState(state, outputIndex)
  const id = item.call_id ?? item.id
  if (typeof id === 'string') {
    toolCall.id = id
  }
  if (typeof item.name === 'string') {
    toolCall.name = item.name
  }
  if (typeof item.arguments === 'string') {
    toolCall.arguments = item.arguments
  }
}

function applyResponsesOutputItem(
  state: StreamingResponsesState,
  outputIndex: number,
  item: OpenAiResponsesOutputItem,
): void {
  if (isResponsesMessageOutputItem(item) && item.role === 'assistant') {
    applyResponsesMessageItem(state, outputIndex, item)
    return
  }

  if (isResponsesReasoningOutputItem(item)) {
    applyResponsesReasoningItem(state, outputIndex, item)
    return
  }

  if (isResponsesFunctionCallOutputItem(item)) {
    applyResponsesFunctionCallItem(state, outputIndex, item)
  }
}

function buildResponsesStreamContent(
  state: StreamingResponsesState,
): ContentBlock[] {
  const content: ContentBlock[] = []

  const outputIndexes = [
    ...new Set([
      ...state.outputOrder,
      ...state.textByOutputIndex.keys(),
      ...state.reasoningByOutputIndex.keys(),
      ...state.toolCallsByOutputIndex.keys(),
    ]),
  ].sort((left, right) => left - right)

  for (const outputIndex of outputIndexes) {
    const text = state.textByOutputIndex.get(outputIndex)
    if (typeof text === 'string' && text.length > 0) {
      const annotations = state.annotationsByOutputIndex.get(outputIndex)
      content.push({
        type: 'text',
        text,
        ...(annotations ? { annotations } : {}),
      })
      continue
    }

    const reasoning = state.reasoningByOutputIndex.get(outputIndex)
    if (reasoning) {
      content.push({
        type: 'reasoning',
        ...(reasoning.id ? { id: reasoning.id } : {}),
        summary: reasoning.summary.length > 0 ? [reasoning.summary] : [],
        ...(reasoning.encryptedContent
          ? { encryptedContent: reasoning.encryptedContent }
          : {}),
        ...(reasoning.status ? { status: reasoning.status } : {}),
      })
      continue
    }

    const toolCall = state.toolCallsByOutputIndex.get(outputIndex)
    if (toolCall && toolCall.id && toolCall.name) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: parseToolArguments(toolCall.arguments),
      })
    }
  }

  return content
}

function parseResponsesStreamEvent(
  state: StreamingResponsesState,
  event: OpenAiResponsesStreamEvent,
  callbacks: CreateMessageStreamCallbacks,
): void {
  if (event.type === 'response.output_text.delta') {
    const outputIndex = getOutputIndex(event)
    if (typeof event.delta === 'string') {
      if (typeof outputIndex === 'number') {
        const appended = appendStreamingTextDelta(
          state,
          outputIndex,
          'output_text',
          event.delta,
        )
        if (appended) {
          callbacks.onTextDelta?.(event.delta)
        }
      } else {
        callbacks.onTextDelta?.(event.delta)
      }
    }
    return
  }

  if (event.type === 'response.output_text.done') {
    const outputIndex = getOutputIndex(event)
    if (typeof outputIndex === 'number' && typeof event.text === 'string') {
      const current = state.textByOutputIndex.get(outputIndex) ?? ''
      state.textByOutputIndex.set(outputIndex, event.text)
      ensureOutputOrder(state, outputIndex)
      if (current.length === 0) {
        callbacks.onTextDelta?.(event.text)
      }
    }
    return
  }

  if (event.type === 'response.output_text.annotation.added') {
    const outputIndex = getOutputIndex(event)
    if (typeof outputIndex === 'number' && event.annotation) {
      const current = state.annotationsByOutputIndex.get(outputIndex) ?? []
      state.annotationsByOutputIndex.set(outputIndex, [
        ...current,
        normalizeAnnotation(event.annotation),
      ])
      ensureOutputOrder(state, outputIndex)
    }
    return
  }

  if (
    event.type === 'response.content_part.added' ||
    event.type === 'response.content_part.done'
  ) {
    const outputIndex = getOutputIndex(event)
    if (typeof outputIndex === 'number') {
      const deltaText =
        typeof event.part?.text === 'string'
          ? event.part.text
          : typeof event.part?.refusal === 'string'
            ? event.part.refusal
            : ''
      if (deltaText.length > 0) {
        const current = state.textByOutputIndex.get(outputIndex) ?? ''
        if (event.type === 'response.content_part.done') {
          state.textByOutputIndex.set(outputIndex, deltaText)
        } else {
          const appended = appendStreamingTextDelta(
            state,
            outputIndex,
            'content_part',
            deltaText,
          )
          if (appended) {
            callbacks.onTextDelta?.(deltaText)
          }
        }
        if (Array.isArray(event.part?.annotations) && event.part.annotations.length > 0) {
          const currentAnnotations =
            state.annotationsByOutputIndex.get(outputIndex) ?? []
          state.annotationsByOutputIndex.set(
            outputIndex,
            currentAnnotations.concat(event.part.annotations.map(normalizeAnnotation)),
          )
        }
        ensureOutputOrder(state, outputIndex)
        if (event.type === 'response.content_part.done' && current.length === 0) {
          callbacks.onTextDelta?.(deltaText)
        }
      }
    }
    return
  }

  if (
    event.type === 'response.refusal.delta' ||
    event.type === 'response.refusal.done'
  ) {
    const outputIndex = getOutputIndex(event)
    if (typeof outputIndex === 'number') {
      const deltaText =
        typeof event.delta === 'string'
          ? event.delta
          : typeof event.refusal === 'string'
            ? event.refusal
            : ''
      if (deltaText.length > 0) {
        const current = state.textByOutputIndex.get(outputIndex) ?? ''
        if (event.type === 'response.refusal.done') {
          state.textByOutputIndex.set(outputIndex, deltaText)
        } else {
          const appended = appendStreamingTextDelta(
            state,
            outputIndex,
            'refusal',
            deltaText,
          )
          if (appended) {
            callbacks.onTextDelta?.(deltaText)
          }
        }
        ensureOutputOrder(state, outputIndex)
        if (event.type === 'response.refusal.done' && current.length === 0) {
          callbacks.onTextDelta?.(deltaText)
        }
      }
    }
    return
  }

  if (
    event.type === 'response.reasoning_summary_text.delta' ||
    event.type === 'response.reasoning_summary_text.done' ||
    event.type === 'response.reasoning_summary_part.added' ||
    event.type === 'response.reasoning_summary_part.done'
  ) {
    const outputIndex = getOutputIndex(event)
    if (typeof outputIndex === 'number') {
      const reasoning = getOrCreateReasoningState(state, outputIndex)
      const deltaText =
        typeof event.delta === 'string'
          ? event.delta
          : typeof event.text === 'string'
            ? event.text
            : typeof event.part?.text === 'string'
              ? event.part.text
              : ''
      if (event.type?.endsWith('.done') && deltaText.length > 0) {
        reasoning.summary = deltaText
      } else if (deltaText.length > 0) {
        reasoning.summary += deltaText
      }
      if (deltaText.length > 0) {
        callbacks.onReasoningDelta?.({
          kind: 'reasoning',
          text: deltaText,
        })
      }
      if (typeof event.item_id === 'string' && !reasoning.id) {
        reasoning.id = event.item_id
      }
    }
    return
  }

  if (
    event.type === 'response.function_call_arguments.delta' ||
    event.type === 'response.function_call_arguments.done'
  ) {
    const outputIndex = getOutputIndex(event)
    if (typeof outputIndex === 'number') {
      const toolCall = getOrCreateToolCallState(state, outputIndex)
      if (typeof event.delta === 'string') {
        toolCall.arguments += event.delta
      } else if (typeof event.arguments === 'string') {
        toolCall.arguments = event.arguments
      }
      if (typeof event.item_id === 'string' && !toolCall.id) {
        toolCall.id = event.item_id
      }
    }
    return
  }

  if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
    const outputIndex = getOutputIndex(event)
    if (typeof outputIndex === 'number' && event.item) {
      applyResponsesOutputItem(state, outputIndex, event.item)
    }
    return
  }

  if (
    (event.type === 'response.completed' || event.type === 'response.done') &&
    event.response
  ) {
    for (const [outputIndex, item] of (event.response.output ?? []).entries()) {
      applyResponsesOutputItem(state, outputIndex, item)
      if (isResponsesMessageOutputItem(item) && item.role === 'assistant') {
        const text = getMessageItemText(item)
        if (text && text.length > 0) {
          state.textByOutputIndex.set(outputIndex, text)
          const annotations = getMessageItemAnnotations(item)
          if (annotations) {
            state.annotationsByOutputIndex.set(outputIndex, annotations)
          }
          ensureOutputOrder(state, outputIndex)
        }
      }
    }
  }
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

    const userContentBlocks = message.content.filter(
      (block): block is Extract<ContentBlock, { type: 'text' | 'image' | 'pdf' }> =>
        block.type === 'text' || block.type === 'image' || block.type === 'pdf',
    )
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
          content: stringifyToolResultForOpenAi(block.output),
        })
      }
      continue
    }

    if (message.role === 'user') {
      const hasAttachment = userContentBlocks.some(
        block => block.type === 'image' || block.type === 'pdf',
      )
      messages.push({
        role: 'user',
        content: hasAttachment
          ? userContentBlocks.map(toChatCompletionContentPart)
          : textBlocks.map(block => block.text).join('\n'),
      })
      continue
    }

    if (userContentBlocks.some(
      block => block.type === 'image' || block.type === 'pdf',
    )) {
      throw new Error(
        'OpenAI attachment blocks are only supported on user messages in dclaw',
      )
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
  if (
    typeof message.reasoning_content === 'string' &&
    message.reasoning_content.length > 0
  ) {
    content.push({
      type: 'thinking',
      thinking: message.reasoning_content,
    })
  }

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
  reasoning: string,
  toolCalls: StreamingToolCallState[],
): ContentBlock[] {
  const content: ContentBlock[] = []

  if (reasoning.length > 0) {
    content.push({
      type: 'thinking',
      thinking: reasoning,
    })
  }

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

function isEventStreamContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('text/event-stream') ?? false
}

function looksLikeSseText(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('event:') || trimmed.startsWith('data:')
}

function shouldParseTextAsSse(text: string, contentType: string | null): boolean {
  return isEventStreamContentType(contentType) || looksLikeSseText(text)
}

function parseResponsesSseContent(
  text: string,
  callbacks: CreateMessageStreamCallbacks,
): ContentBlock[] {
  const streamState: StreamingResponsesState = {
    textByOutputIndex: new Map(),
    annotationsByOutputIndex: new Map(),
    reasoningByOutputIndex: new Map(),
    toolCallsByOutputIndex: new Map(),
    lastTextAppendByOutputIndex: new Map(),
    outputOrder: [],
  }
  let terminalResponse: OpenAiResponsesResponse | undefined

  parseSseTextEvents(text, (event: SseEvent) => {
    if (event.data === '[DONE]') {
      return
    }

    const payload = JSON.parse(event.data) as OpenAiResponsesStreamEvent
    if (payload.type === 'error' && payload.error?.message) {
      throw new Error(`OpenAI streaming request failed: ${payload.error.message}`)
    }

    if (
      (payload.type === 'response.completed' ||
        payload.type === 'response.done') &&
      payload.response
    ) {
      terminalResponse = payload.response
    }

    parseResponsesStreamEvent(streamState, payload, callbacks)
  })

  const terminalContent = terminalResponse
    ? parseResponsesResponse(terminalResponse)
    : []
  return terminalContent.length > 0
    ? terminalContent
    : buildResponsesStreamContent(streamState)
}

function parseChatCompletionSseContent(
  text: string,
  callbacks: CreateMessageStreamCallbacks,
): ContentBlock[] {
  let outputText = ''
  let reasoning = ''
  const toolCalls: StreamingToolCallState[] = []

  parseSseTextEvents(text, (event: SseEvent) => {
    if (event.data === '[DONE]') {
      return
    }

    const chunk = JSON.parse(event.data) as OpenAiChatCompletionChunk
    const delta = chunk.choices?.[0]?.delta
    if (!delta) {
      return
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      outputText += delta.content
      callbacks.onTextDelta?.(delta.content)
    }

    if (
      typeof delta.reasoning_content === 'string' &&
      delta.reasoning_content.length > 0
    ) {
      reasoning += delta.reasoning_content
      callbacks.onReasoningDelta?.({
        kind: 'thinking',
        text: delta.reasoning_content,
      })
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

  return buildChatCompletionContent(outputText, reasoning, toolCalls)
}

function parseResponsesResponseText(
  text: string,
  contentType: string | null,
  callbacks: CreateMessageStreamCallbacks = {},
): ContentBlock[] {
  if (shouldParseTextAsSse(text, contentType)) {
    return parseResponsesSseContent(text, callbacks)
  }

  return parseResponsesResponse(JSON.parse(text) as OpenAiResponsesResponse)
}

function parseChatCompletionResponseText(
  text: string,
  contentType: string | null,
  callbacks: CreateMessageStreamCallbacks = {},
): ContentBlock[] {
  if (shouldParseTextAsSse(text, contentType)) {
    return parseChatCompletionSseContent(text, callbacks)
  }

  return parseChatCompletionResponse(
    JSON.parse(text) as OpenAiChatCompletionResponse,
  )
}

function buildResponsesRequestBody(
  request: CreateMessageRequest,
  model: string,
  maxOutputTokens: number | undefined,
  stream: boolean,
  options: ResolvedOpenAiResponsesOptions,
): Record<string, unknown> {
  const textConfig: Record<string, unknown> = {}
  if (options.verbosity) {
    textConfig.verbosity = options.verbosity
  }
  if (options.textFormat) {
    textConfig.format = options.textFormat
  }

  const reasoningConfig: Record<string, unknown> = {}
  if (options.reasoningEffort) {
    reasoningConfig.effort = options.reasoningEffort
  }

  return {
    model,
    instructions: request.systemPrompt,
    input:
      options.store === false
        ? stripStoredResponseIdsWhenStoreIsFalse(toResponsesInput(request.messages))
        : toResponsesInput(request.messages),
    tools: toOpenAiTools(request.tools),
    ...(typeof maxOutputTokens === 'number'
      ? { max_output_tokens: maxOutputTokens }
      : {}),
    ...(Object.keys(textConfig).length > 0 ? { text: textConfig } : {}),
    ...(Object.keys(reasoningConfig).length > 0
      ? { reasoning: reasoningConfig }
      : {}),
    ...(typeof options.previousResponseId === 'string'
      ? { previous_response_id: options.previousResponseId }
      : {}),
    ...(typeof options.store === 'boolean' ? { store: options.store } : {}),
    ...(typeof options.parallelToolCalls === 'boolean'
      ? { parallel_tool_calls: options.parallelToolCalls }
      : {}),
    ...(typeof options.maxToolCalls === 'number'
      ? { max_tool_calls: options.maxToolCalls }
      : {}),
    ...(options.include && options.include.length > 0
      ? { include: options.include }
      : {}),
    ...(options.truncation ? { truncation: options.truncation } : {}),
    ...(options.metadata &&
    Object.keys(options.metadata).length > 0
      ? { metadata: options.metadata }
      : {}),
    stream,
  }
}

function buildChatCompletionsRequestBody(
  request: CreateMessageRequest,
  model: string,
  maxOutputTokens: number,
  stream: boolean,
  options: ResolvedOpenAiResponsesOptions,
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
    ...(typeof options.store === 'boolean' ? { store: options.store } : {}),
    stream,
  }
}

export class OpenAiLlmClient implements LlmClient {
  readonly providerName = 'openai'

  private readonly apiKey?: string
  private readonly baseUrl: string
  private readonly defaultModel?: string
  private readonly apiStyle: OpenAiApiStyle
  private readonly modelCatalogOverrides?: ModelCatalogOverrides
  private readonly defaultTextVerbosity?: OpenAiTextVerbosity
  private readonly defaultReasoningEffort?: OpenAiReasoningEffort
  private readonly defaultStore?: boolean
  private readonly fetchImpl: typeof fetch
  private readonly env: NodeJS.ProcessEnv
  private readonly maxRetries: number
  private readonly requestTimeoutMs: number
  private readonly sleepImpl?: SleepImpl
  private readonly streamIdleTimeoutMs?: number

  constructor(options: OpenAiLlmClientOptions = {}) {
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1'
    this.defaultModel = options.defaultModel
    this.apiStyle = options.apiStyle ?? 'responses'
    this.modelCatalogOverrides = options.modelCatalogOverrides
    this.defaultTextVerbosity = options.defaultTextVerbosity
    this.defaultReasoningEffort = options.defaultReasoningEffort
    this.defaultStore = options.defaultStore
    this.fetchImpl = options.fetchImpl ?? fetch
    this.env = options.env ?? process.env
    this.maxRetries = options.maxRetries ?? getLlmMaxRetries(this.env)
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? getLlmRequestTimeoutMs(this.env)
    this.sleepImpl = options.sleepImpl
    const streamWatchdogEnabled =
      options.streamWatchdogEnabled ?? isStreamWatchdogEnabled(this.env)
    this.streamIdleTimeoutMs = streamWatchdogEnabled
      ? (options.streamIdleTimeoutMs ?? getStreamIdleTimeoutMs(this.env))
      : undefined
  }

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    const { model, limits, responsesOptions } = this.resolveRequestContext(request)
    validateImagesForProvider(request.messages)

    if (this.apiStyle === 'chat-completions') {
      const content = await this.withRetry(async () => {
        return this.withRequestTimeout(async signal => {
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
                responsesOptions,
              ),
            ),
            signal,
          })

          if (!response.ok) {
            throw await this.createRequestError(response)
          }

          const responseText = await response.text()
          return parseChatCompletionResponseText(
            responseText,
            response.headers.get('content-type'),
          )
        }, request.signal)
      })
      if (content.length === 0) {
        throw new Error('OpenAI response did not contain supported content blocks')
      }

      return {
        message: createMessage('assistant', content),
      }
    }

    const content = await this.withRetry(async () => {
      return this.withRequestTimeout(async signal => {
        const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey!}`,
          },
          body: JSON.stringify(
            buildResponsesRequestBody(
              request,
              model,
              this.apiStyle === 'codex-responses'
                ? undefined
                : limits.maxOutputTokens,
              false,
              responsesOptions,
            ),
          ),
          signal,
        })

        if (!response.ok) {
          throw await this.createRequestError(response)
        }

        const responseText = await response.text()
        return parseResponsesResponseText(
          responseText,
          response.headers.get('content-type'),
        )
      }, request.signal)
    })
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
    const { model, limits, responsesOptions } = this.resolveRequestContext(request)
    validateImagesForProvider(request.messages)

    if (this.apiStyle !== 'chat-completions') {
      return this.withRetry(async () => {
        const response = await this.withRequestTimeout(async signal => {
          const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.apiKey!}`,
            },
            body: JSON.stringify(
              buildResponsesRequestBody(
                request,
                model,
                this.apiStyle === 'codex-responses'
                  ? undefined
                  : limits.maxOutputTokens,
                true,
                responsesOptions,
              ),
            ),
            signal,
          })

          if (!response.ok) {
            throw await this.createRequestError(response)
          }

          return response
        }, request.signal)

        const streamState: StreamingResponsesState = {
          textByOutputIndex: new Map(),
          annotationsByOutputIndex: new Map(),
          reasoningByOutputIndex: new Map(),
          toolCallsByOutputIndex: new Map(),
          lastTextAppendByOutputIndex: new Map(),
          outputOrder: [],
        }
        let terminalResponse: OpenAiResponsesResponse | undefined
        let sawStreamEvent = false
        let sawStreamData = false

        try {
          await readSseEvents(
            response,
            (event: SseEvent) => {
              if (event.data === '[DONE]') {
                return
              }

              sawStreamEvent = true
              const payload = JSON.parse(event.data) as OpenAiResponsesStreamEvent
              if (payload.type === 'error' && payload.error?.message) {
                throw new Error(`OpenAI streaming request failed: ${payload.error.message}`)
              }

              if (
                payload.type === 'response.completed' ||
                payload.type === 'response.done'
              ) {
                if (payload.response) {
                  terminalResponse = payload.response
                }
              }

              parseResponsesStreamEvent(streamState, payload, callbacks)
            },
            {
              ...(this.streamIdleTimeoutMs === undefined
                ? {}
                : { idleTimeoutMs: this.streamIdleTimeoutMs }),
              onChunk(chunk) {
                if (chunk.length > 0) {
                  sawStreamData = true
                }
              },
            },
          )
        } catch (error) {
          if (sawStreamEvent || sawStreamData) {
            throw new NonRetryableError(error)
          }
          return this.createMessage(request)
        }

        const terminalContent = terminalResponse
          ? parseResponsesResponse(terminalResponse)
          : []
        const content: ContentBlock[] =
          terminalContent.length > 0
            ? terminalContent
            : buildResponsesStreamContent(streamState)
        if (content.length === 0) {
          return this.createMessage(request)
        }

        return {
          message: createMessage('assistant', content),
        }
      })
    }

    return this.withRetry(async () => {
      const response = await this.withRequestTimeout(async signal => {
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
              true,
              responsesOptions,
            ),
          ),
          signal,
        })

        if (!response.ok) {
          throw await this.createRequestError(response)
        }

        return response
      }, request.signal)

      let text = ''
      let reasoning = ''
      const toolCalls: StreamingToolCallState[] = []
      let sawStreamEvent = false
      let sawStreamData = false

      try {
        await readSseEvents(
          response,
          (event: SseEvent) => {
            if (event.data === '[DONE]') {
              return
            }

            sawStreamEvent = true
            const chunk = JSON.parse(event.data) as OpenAiChatCompletionChunk
            const delta = chunk.choices?.[0]?.delta
            if (!delta) {
              return
            }

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              text += delta.content
              callbacks.onTextDelta?.(delta.content)
            }

            if (
              typeof delta.reasoning_content === 'string' &&
              delta.reasoning_content.length > 0
            ) {
              reasoning += delta.reasoning_content
              callbacks.onReasoningDelta?.({
                kind: 'thinking',
                text: delta.reasoning_content,
              })
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
          },
          {
            ...(this.streamIdleTimeoutMs === undefined
              ? {}
              : { idleTimeoutMs: this.streamIdleTimeoutMs }),
            onChunk(chunk) {
              if (chunk.length > 0) {
                sawStreamData = true
              }
            },
          },
        )
      } catch (error) {
        if (sawStreamEvent || sawStreamData) {
          throw new NonRetryableError(error)
        }
        return this.createMessage(request)
      }

      const content = buildChatCompletionContent(text, reasoning, toolCalls)
      if (content.length === 0) {
        return this.createMessage(request)
      }

      return {
        message: createMessage('assistant', content),
      }
    })
  }

  private resolveRequestContext(request: CreateMessageRequest): {
    model: string
    limits: ReturnType<typeof resolveModelLimits>
    responsesOptions: ResolvedOpenAiResponsesOptions
  } {
    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is required. Configure llm.providers.<name>.apiKey in ~/.dclaw/config.json.',
      )
    }

    const { model } = resolveModelSelection(request.model, this.defaultModel)
    if (!model) {
      throw new Error(
        'OpenAI model is required. Configure llm.runtimes.<name>.primary.model.',
      )
    }

    return {
      model,
      limits: resolveModelLimits('openai', model, {
        env: this.env,
        overrides: this.modelCatalogOverrides,
      }),
      responsesOptions: this.resolveResponsesOptions(request),
    }
  }

  private resolveResponsesOptions(
    request: CreateMessageRequest,
  ): ResolvedOpenAiResponsesOptions {
    const requestOptions: OpenAiResponsesRequestOptions | undefined =
      request.providerOptions?.openai

    return {
      verbosity: requestOptions?.verbosity ?? this.defaultTextVerbosity,
      reasoningEffort:
        requestOptions?.reasoningEffort ?? this.defaultReasoningEffort,
      previousResponseId: requestOptions?.previousResponseId,
      store:
        this.apiStyle === 'codex-responses'
          ? false
          : (requestOptions?.store ?? this.defaultStore),
      parallelToolCalls: requestOptions?.parallelToolCalls,
      maxToolCalls: requestOptions?.maxToolCalls,
      include: requestOptions?.include,
      truncation: requestOptions?.truncation,
      metadata: requestOptions?.metadata,
      textFormat: requestOptions?.textFormat,
    }
  }

  private async createRequestError(response: Response): Promise<RetryableHttpError> {
    const details = await getHttpErrorDetails(response)
    return new RetryableHttpError(
      'OpenAI',
      response.status,
      response.statusText,
      details,
      response.headers,
    )
  }

  private withRetry<T>(operation: (attempt: number) => Promise<T>): Promise<T> {
    return withRetry(operation, {
      maxRetries: this.maxRetries,
      sleepImpl: this.sleepImpl,
    })
  }

  private withRequestTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return withTimeout(operation, {
      timeoutMs: this.requestTimeoutMs,
      timeoutMessage: `OpenAI request timed out after ${this.requestTimeoutMs}ms`,
      signal,
    })
  }
}
