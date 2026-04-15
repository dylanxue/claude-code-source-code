import type { ToolResult } from '../../types/tool.js'
import type { Tool } from '../types.js'

export type WebFetchToolInput = {
  url: string
  prompt: string
}

export type WebFetchToolOutput = {
  bytes: number
  code: number
  codeText: string
  result: string
  durationMs: number
  url: string
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input
  }
  return `${input.slice(0, maxLength)}...`
}

export const webFetchTool: Tool<WebFetchToolInput, WebFetchToolOutput> = {
  name: 'WebFetch',
  description: 'Fetch content from a URL and apply a prompt to it.',
  validate(input) {
    if (!input.url || !input.prompt) {
      return {
        ok: false,
        error: 'WebFetch requires both url and prompt',
      }
    }

    try {
      new URL(input.url)
    } catch {
      return {
        ok: false,
        error: `Invalid URL: ${input.url}`,
      }
    }

    return { ok: true }
  },
  isReadOnly() {
    return true
  },
  async call(input): Promise<ToolResult<WebFetchToolOutput>> {
    const start = Date.now()
    const response = await fetch(input.url, {
      headers: {
        'user-agent': 'dclaw/0.1.0',
      },
    })

    const rawText = await response.text()
    const contentType = response.headers.get('content-type') ?? ''
    const normalizedText = contentType.includes('html')
      ? stripHtml(rawText)
      : rawText.trim()
    const excerpt = truncateText(normalizedText, 12_000)
    const result = [
      `Prompt: ${input.prompt}`,
      '',
      `Fetched from: ${input.url}`,
      '',
      excerpt || '<empty>',
    ].join('\n')

    return {
      ok: true,
      output: {
        bytes: Buffer.byteLength(rawText, 'utf8'),
        code: response.status,
        codeText: response.statusText,
        result,
        durationMs: Date.now() - start,
        url: response.url,
      },
      summary: `Fetched ${response.url}`,
    }
  },
}
