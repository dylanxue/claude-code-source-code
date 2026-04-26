import type { CompactBoundary } from '../compact/types.js'

export type TextAnnotation = {
  type?: string
  startIndex?: number
  endIndex?: number
  title?: string
  url?: string
  fileId?: string
  filename?: string
  raw?: Record<string, unknown>
}

export type TextContentBlock = {
  type: 'text'
  text: string
  annotations?: TextAnnotation[]
}

export type Base64ImageSource = {
  type: 'base64'
  mediaType: string
  data: string
}

export type ImageContentBlock = {
  type: 'image'
  source: Base64ImageSource
}

export type Base64PdfSource = {
  type: 'base64'
  mediaType: 'application/pdf'
  data: string
}

export type PdfContentBlock = {
  type: 'pdf'
  source: Base64PdfSource
  filename?: string
}

export type ThinkingContentBlock = {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type RedactedThinkingContentBlock = {
  type: 'redacted_thinking'
  data: string
}

export type ReasoningContentBlock = {
  type: 'reasoning'
  id?: string
  summary: string[]
  encryptedContent?: string
  status?: string
}

export type ToolUseContentBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultStructuredContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | PdfContentBlock

export type ToolResultContentBlock = {
  type: 'tool_result'
  toolUseId: string
  output: unknown
  rawOutput?: unknown
  content?: ToolResultStructuredContentBlock[]
}

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | PdfContentBlock
  | ThinkingContentBlock
  | RedactedThinkingContentBlock
  | ReasoningContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock

export type MessageRole = 'system' | 'user' | 'assistant'

export type Message = {
  id: string
  role: MessageRole
  content: ContentBlock[]
  createdAt: string
  compactBoundary?: CompactBoundary
  transcriptOnly?: boolean
}

export function createMessage(
  role: MessageRole,
  content: ContentBlock[],
): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

export function createTextMessage(role: MessageRole, text: string): Message {
  return createMessage(role, [{ type: 'text', text }])
}

export function createImageBlock(
  mediaType: string,
  data: string,
): ImageContentBlock {
  return {
    type: 'image',
    source: {
      type: 'base64',
      mediaType,
      data,
    },
  }
}

export function createPdfBlock(
  data: string,
  filename?: string,
): PdfContentBlock {
  return {
    type: 'pdf',
    source: {
      type: 'base64',
      mediaType: 'application/pdf',
      data,
    },
    ...(filename ? { filename } : {}),
  }
}

export function createTranscriptOnlyTextMessage(
  role: MessageRole,
  text: string,
): Message {
  return {
    ...createTextMessage(role, text),
    transcriptOnly: true,
  }
}

export function createToolUseMessage(
  role: MessageRole,
  name: string,
  input: Record<string, unknown>,
): Message {
  return createMessage(role, [
    {
      type: 'tool_use',
      id: `tool_${Math.random().toString(36).slice(2, 10)}`,
      name,
      input,
    },
  ])
}

export function createToolResultMessage(
  role: MessageRole,
  toolUseId: string,
  output: unknown,
  rawOutput?: unknown,
  content?: ToolResultStructuredContentBlock[],
): Message {
  return createMessage(role, [
    {
      type: 'tool_result',
      toolUseId,
      output,
      ...(rawOutput === undefined ? {} : { rawOutput }),
      ...(content === undefined || content.length === 0 ? {} : { content }),
    },
  ])
}

export function getTextContent(message: Message): string {
  return message.content
    .filter((block): block is TextContentBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

export function getToolUseBlocks(message: Message): ToolUseContentBlock[] {
  return message.content.filter(
    (block): block is ToolUseContentBlock => block.type === 'tool_use',
  )
}

export function getImageContentBlocks(message: Message): ImageContentBlock[] {
  return message.content.filter(
    (block): block is ImageContentBlock => block.type === 'image',
  )
}

export function getPdfContentBlocks(message: Message): PdfContentBlock[] {
  return message.content.filter(
    (block): block is PdfContentBlock => block.type === 'pdf',
  )
}

export function getModelVisibleMessages(messages: Message[]): Message[] {
  return messages.filter(message => message.transcriptOnly !== true)
}
