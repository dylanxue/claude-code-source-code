import { createParser } from 'eventsource-parser'

type ErrorMessageShape = {
  error?: {
    message?: string
  }
}

export type SseEvent = {
  event?: string
  data: string
}

export function trimOrUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function normalizeBaseUrl(
  value: string | undefined,
  fallback: string,
): string {
  const resolved = trimOrUndefined(value) ?? fallback
  return resolved.replace(/\/+$/, '')
}

export function stringifyJson(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

export async function getHttpErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    const parsed = JSON.parse(text) as ErrorMessageShape
    if (parsed.error?.message) {
      return parsed.error.message
    }
    if (text.trim().length > 0) {
      return text.trim()
    }
  } catch {}

  return `HTTP ${response.status}`
}

export async function readSseEvents(
  response: Response,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error('Streaming response body is not available')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createParser({
    onEvent(event) {
      onEvent({
        event: event.event,
        data: event.data,
      })
    },
  })

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    parser.feed(decoder.decode(value, { stream: true }))
  }

  parser.feed(decoder.decode())
}
