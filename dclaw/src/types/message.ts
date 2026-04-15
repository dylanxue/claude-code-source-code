export type TextContentBlock = {
  type: 'text'
  text: string
}

export type ToolUseContentBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultContentBlock = {
  type: 'tool_result'
  toolUseId: string
  output: unknown
}

export type ContentBlock =
  | TextContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock

export type MessageRole = 'system' | 'user' | 'assistant'

export type Message = {
  id: string
  role: MessageRole
  content: ContentBlock[]
  createdAt: string
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
): Message {
  return createMessage(role, [
    {
      type: 'tool_result',
      toolUseId,
      output,
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
