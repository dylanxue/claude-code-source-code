import type {
  ContentBlock,
  Message,
  ToolUseContentBlock,
} from '../types/message.js'

export type VerboseRuntimeInfo = {
  mode: 'interactive' | 'print' | 'resume'
  cwd: string
  provider: string
  providerSource?: string
  model?: string
  modelSource?: string
  permissionMode: string
  permissionModeSource?: string
  stream: boolean
  outputFormat: 'text' | 'sse'
  sessionId?: string
  queryTracePath?: string
}

export type VerboseLlmErrorEvent = {
  iteration: number
  streaming: boolean
  phase: 'before_response' | 'during_stream'
  kind: string
  subtype: string
  message: string
  errorName?: string
  streamedTextChars: number
  streamedReasoningChars: number
  lastTextDelta?: string
  lastReasoningDelta?: {
    kind: 'reasoning' | 'thinking'
    text: string
  }
}

export type VerboseCompactDryRunEvent = {
  iteration: number
  phase: 'iteration_start' | 'post_tool_results'
  recommendation: {
    level: string
    shouldCompact: boolean
    reasons: string[]
    tokenUsage: number
    effectiveContextWindowTokens?: number
    autoCompactThresholdTokens?: number
    percentLeft?: number
    percentUsed?: number
    isAboveWarningThreshold: boolean
    isAboveErrorThreshold: boolean
    isAboveAutoCompactThreshold: boolean
    isAtBlockingLimit: boolean
  }
}

export type VerboseAutoCompactEvent = {
  sessionId: string
  boundaryId: string
  reason: string
  summaryMessageId: string
}

function stringifyInline(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function formatReasoningBlock(block: ContentBlock): string | null {
  switch (block.type) {
    case 'reasoning':
      return `[reasoning] ${
        block.summary.length > 0
          ? block.summary.join(' ')
          : `status=${block.status ?? 'unknown'}`
      }`
    case 'thinking':
      return `[reasoning:thinking] ${block.thinking}`
    case 'redacted_thinking':
      return `[reasoning:redacted] hidden (${block.data.length} chars)`
    default:
      return null
  }
}

export function formatReasoningDeltaPrefix(
  kind: 'reasoning' | 'thinking',
): string {
  return kind === 'reasoning' ? '[reasoning] ' : '[reasoning:thinking] '
}

function formatContentBlock(block: ContentBlock): string | null {
  if (block.type !== 'text') {
    return null
  }

  return `[content] ${block.text}`
}

function formatToolCallBlock(block: ContentBlock): string | null {
  if (block.type !== 'tool_use') {
    return null
  }

  return `[tool_call] ${block.name} ${stringifyInline(block.input)}`
}

export function formatToolUseLine(toolUse: {
  name: string
  input: Record<string, unknown>
}): string {
  return `[tool_call] ${toolUse.name} ${stringifyInline(toolUse.input)}`
}

export function formatLlmErrorLine(error: VerboseLlmErrorEvent): string {
  const parts = [
    `[llm_error] phase=${error.phase}`,
    `kind=${error.kind}`,
    `subtype=${error.subtype}`,
    `message=${error.message}`,
  ]
  if (error.streamedReasoningChars > 0) {
    parts.push(`streamed_reasoning_chars=${error.streamedReasoningChars}`)
  }
  if (error.streamedTextChars > 0) {
    parts.push(`streamed_text_chars=${error.streamedTextChars}`)
  }
  return parts.join(' ')
}

export function formatCompactDryRunLine(
  event: VerboseCompactDryRunEvent,
): string {
  const parts = [
    `[compact_dry_run] phase=${event.phase}`,
    `pressure=${event.recommendation.level}`,
    `tokens=${event.recommendation.tokenUsage}`,
    `threshold=${event.recommendation.autoCompactThresholdTokens ?? 'unknown'}`,
    `remaining=${event.recommendation.percentLeft === undefined ? 'unknown' : `${event.recommendation.percentLeft}%`}`,
    `used=${event.recommendation.percentUsed === undefined ? 'unknown' : `${event.recommendation.percentUsed}%`}`,
    `warning=${event.recommendation.isAboveWarningThreshold}`,
    `auto=${event.recommendation.isAboveAutoCompactThreshold}`,
    `blocking=${event.recommendation.isAtBlockingLimit}`,
    `recommendation=${event.recommendation.shouldCompact ? 'compact_soon' : 'none'}`,
  ]

  if (event.recommendation.reasons.length > 0) {
    parts.push(`reasons=${event.recommendation.reasons.join('; ')}`)
  }

  return parts.join(' ')
}

export function formatAutoCompactLine(
  event: VerboseAutoCompactEvent,
): string {
  return [
    '[autocompact]',
    `session=${event.sessionId}`,
    `boundary=${event.boundaryId}`,
    `summary=${event.summaryMessageId}`,
    `reason=${event.reason}`,
  ].join(' ')
}

export function formatVerboseContextLines(
  info: VerboseRuntimeInfo,
): string[] {
  const lines = [
    `[meta] mode=${info.mode}`,
    `[meta] cwd=${info.cwd}`,
    `[meta] provider=${info.provider}`,
    `[meta] model=${info.model ?? 'default'}`,
    `[meta] permission_mode=${info.permissionMode}`,
    `[meta] stream=${info.stream}`,
    `[meta] output_format=${info.outputFormat}`,
  ]

  if (info.providerSource) {
    lines.push(`[meta] provider_source=${info.providerSource}`)
  }
  if (info.modelSource) {
    lines.push(`[meta] model_source=${info.modelSource}`)
  }
  if (info.permissionModeSource) {
    lines.push(`[meta] permission_mode_source=${info.permissionModeSource}`)
  }
  if (info.sessionId) {
    lines.push(`[meta] session_id=${info.sessionId}`)
  }
  if (info.queryTracePath) {
    lines.push(`[meta] query_trace=${info.queryTracePath}`)
  }

  return lines
}

export function formatVerboseLines(
  messages: Message[],
  options: {
    includeToolCalls?: boolean
    includeReasoning?: boolean
    includeContent?: boolean
  } = {},
): string[] {
  const includeToolCalls = options.includeToolCalls ?? true
  const includeReasoning = options.includeReasoning ?? true
  const includeContent = options.includeContent ?? true
  const lines: string[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }

    for (const block of message.content) {
      if (includeReasoning) {
        const reasoningLine = formatReasoningBlock(block)
        if (reasoningLine) {
          lines.push(reasoningLine)
        }
      }

      if (includeContent) {
        const contentLine = formatContentBlock(block)
        if (contentLine) {
          lines.push(contentLine)
        }
      }

      if (includeToolCalls) {
        const toolCallLine = formatToolCallBlock(block)
        if (toolCallLine) {
          lines.push(toolCallLine)
        }
      }
    }
  }

  return lines
}

export function formatVerboseMessageLines(
  message: Pick<Message, 'id' | 'role' | 'content'>,
  options: {
    includeToolCalls?: boolean
    includeReasoning?: boolean
    includeContent?: boolean
  } = {},
): string[] {
  return formatVerboseLines(
    [
      {
        ...message,
        createdAt: '',
      },
    ],
    options,
  )
}

export function getVerboseReasoningBlocks(
  content: ContentBlock[],
): Array<ContentBlock> {
  return content.filter(
    block =>
      block.type === 'reasoning' ||
      block.type === 'thinking' ||
      block.type === 'redacted_thinking',
  )
}

export function getVerboseContentBlocks(
  content: ContentBlock[],
): Array<ContentBlock> {
  return content.filter(block => block.type === 'text')
}

export function collectToolCalls(messages: Message[]): ToolUseContentBlock[] {
  const toolCalls: ToolUseContentBlock[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }

    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolCalls.push(block)
      }
    }
  }

  return toolCalls
}

export function summarizeToolCalls(
  toolCalls: ToolUseContentBlock[],
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return toolCalls.map(block => ({
    id: block.id,
    name: block.name,
    input: block.input,
  }))
}
