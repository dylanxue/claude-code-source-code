import { getTextContent, type Message } from '../types/message.js'

const DEFAULT_SUMMARY = 'Completed without a textual response.'
const MAX_SUMMARY_CHARS = 600

function normalizeWhitespace(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function truncate(value: string, maxChars: number = MAX_SUMMARY_CHARS): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`
}

export function buildAgentResultSummary(
  messages: Message[],
  outputText?: string,
): string {
  const normalizedOutput = normalizeWhitespace(outputText)
  if (normalizedOutput) {
    return truncate(normalizedOutput)
  }

  const lastAssistant = [...messages]
    .reverse()
    .find(message => message.role === 'assistant')
  const lastAssistantText = normalizeWhitespace(
    lastAssistant ? getTextContent(lastAssistant) : undefined,
  )

  return truncate(lastAssistantText ?? DEFAULT_SUMMARY)
}
