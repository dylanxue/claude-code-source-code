import type { ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'

const MAX_RESULT_CHARS = 16_000
const MAX_METADATA_CHARS = 300
const MAX_EXCERPTS = 6
const MAX_SECTION_CHARS = 1_800
const REDIRECT_STATUS_TEXT: Record<number, string> = {
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
}

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
  contentType: string
  title?: string
  description?: string
  wasTruncated: boolean
}

type RedirectResponse = {
  type: 'redirect'
  location: string
  response: Response
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function truncateText(
  input: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  if (input.length <= maxLength) {
    return {
      text: input,
      truncated: false,
    }
  }

  return {
    text: `${input.slice(0, maxLength)}...`,
    truncated: true,
  }
}

function normalizeUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl)
  const isLocalhost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]'

  if (parsed.protocol === 'http:' && !isLocalhost) {
    parsed.protocol = 'https:'
  }

  return parsed.toString()
}

function extractHtmlMetadata(rawHtml: string): {
  title?: string
  description?: string
} {
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const descriptionMatch = rawHtml.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
  )

  const title = titleMatch?.[1]
    ? truncateText(
        normalizeWhitespace(decodeHtmlEntities(titleMatch[1])),
        MAX_METADATA_CHARS,
      ).text
    : undefined
  const description = descriptionMatch?.[1]
    ? truncateText(
        normalizeWhitespace(decodeHtmlEntities(descriptionMatch[1])),
        MAX_METADATA_CHARS,
      ).text
    : undefined

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  }
}

function htmlToText(rawHtml: string): string {
  const blockTags =
    /<\/?(article|aside|blockquote|br|div|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul)[^>]*>/gi

  const text = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(blockTags, '\n')
    .replace(/<[^>]+>/g, ' ')

  return normalizeWhitespace(decodeHtmlEntities(text))
}

function normalizeFetchedText(rawText: string, contentType: string): {
  text: string
  title?: string
  description?: string
} {
  const normalizedContentType = contentType.toLowerCase()

  if (normalizedContentType.includes('html')) {
    return {
      ...extractHtmlMetadata(rawText),
      text: htmlToText(rawText),
    }
  }

  if (normalizedContentType.includes('json')) {
    try {
      return {
        text: JSON.stringify(JSON.parse(rawText), null, 2),
      }
    } catch {
      return {
        text: normalizeWhitespace(rawText),
      }
    }
  }

  return {
    text: normalizeWhitespace(rawText),
  }
}

function splitIntoSections(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(section => normalizeWhitespace(section))
    .filter(section => section.length > 0)

  if (paragraphs.length > 1) {
    return paragraphs.flatMap(section => {
      if (section.length <= MAX_SECTION_CHARS) {
        return [section]
      }

      const chunks: string[] = []
      for (let index = 0; index < section.length; index += MAX_SECTION_CHARS) {
        chunks.push(section.slice(index, index + MAX_SECTION_CHARS).trim())
      }
      return chunks.filter(Boolean)
    })
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)

  if (sentences.length === 0) {
    return []
  }

  const sections: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (
      current.length > 0 &&
      current.length + sentence.length + 1 > MAX_SECTION_CHARS
    ) {
      sections.push(current.trim())
      current = sentence
      continue
    }

    current = current.length > 0 ? `${current} ${sentence}` : sentence
  }

  if (current.trim().length > 0) {
    sections.push(current.trim())
  }

  return sections
}

function extractPromptKeywords(prompt: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'describe',
    'extract',
    'find',
    'for',
    'from',
    'get',
    'give',
    'how',
    'in',
    'into',
    'is',
    'it',
    'list',
    'me',
    'of',
    'on',
    'or',
    'page',
    'provide',
    'show',
    'summarize',
    'summary',
    'tell',
    'that',
    'the',
    'this',
    'to',
    'what',
    'which',
    'with',
  ])

  const keywords = prompt
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,}/g)
    ?.filter(token => token.length >= 3 && !stopWords.has(token))

  return keywords ? [...new Set(keywords)] : []
}

function scoreSection(section: string, prompt: string, keywords: string[]): number {
  const normalized = section.toLowerCase()
  let score = 0

  for (const keyword of keywords) {
    const matches = normalized.match(new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'g'))
    if (!matches) {
      continue
    }

    score += matches.length * 6

    if (normalized.startsWith(keyword)) {
      score += 3
    }
  }

  const promptLower = prompt.toLowerCase()
  if (promptLower.length >= 12 && normalized.includes(promptLower)) {
    score += 12
  }

  if (section.length > 900) {
    score -= 2
  }

  return score
}

function selectRelevantSections(
  normalizedText: string,
  prompt: string,
): {
  selectedText: string
  selectionMode: 'prompt_relevant' | 'leading_excerpt'
} {
  const sections = splitIntoSections(normalizedText)
  if (sections.length === 0) {
    return {
      selectedText: '',
      selectionMode: 'leading_excerpt',
    }
  }

  const keywords = extractPromptKeywords(prompt)
  if (keywords.length === 0) {
    return {
      selectedText: sections.slice(0, 3).join('\n\n'),
      selectionMode: 'leading_excerpt',
    }
  }

  const rankedSections = sections
    .map((section, index) => ({
      section,
      index,
      score: scoreSection(section, prompt, keywords),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_EXCERPTS)
    .sort((left, right) => left.index - right.index)

  if (rankedSections.length === 0) {
    return {
      selectedText: sections.slice(0, 3).join('\n\n'),
      selectionMode: 'leading_excerpt',
    }
  }

  return {
    selectedText: rankedSections.map(candidate => candidate.section).join('\n\n'),
    selectionMode: 'prompt_relevant',
  }
}

async function fetchWithRedirectHandling(
  inputUrl: string,
  redirectLimit: number = 5,
): Promise<Response | RedirectResponse> {
  let currentUrl = inputUrl

  for (let attempt = 0; attempt <= redirectLimit; attempt += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        'user-agent': 'dclaw/0.1.0',
        accept:
          'text/html,application/xhtml+xml,application/json,text/plain,text/markdown;q=0.9,*/*;q=0.1',
      },
    })

    const location = response.headers.get('location')
    if (
      location &&
      response.status >= 300 &&
      response.status < 400 &&
      attempt < redirectLimit
    ) {
      const redirectUrl = new URL(location, currentUrl).toString()
      const currentHost = new URL(currentUrl).host
      const redirectHost = new URL(redirectUrl).host

      if (currentHost !== redirectHost) {
        return {
          type: 'redirect',
          location: redirectUrl,
          response,
        }
      }

      currentUrl = redirectUrl
      continue
    }

    return response
  }

  throw new Error(`WebFetch exceeded redirect limit while fetching ${inputUrl}`)
}

function buildRedirectMessage(
  requestedUrl: string,
  redirectUrl: string,
  status: number,
  prompt: string,
): string {
  const codeText = REDIRECT_STATUS_TEXT[status] ?? 'Redirect'
  return [
    'REDIRECT DETECTED: The URL redirects to a different host.',
    '',
    `Original URL: ${requestedUrl}`,
    `Redirect URL: ${redirectUrl}`,
    `Status: ${status} ${codeText}`,
    '',
    'To continue, call WebFetch again with:',
    `- url: "${redirectUrl}"`,
    `- prompt: "${prompt}"`,
  ].join('\n')
}

function buildResultText(
  input: WebFetchToolInput,
  response: Response,
  contentType: string,
  normalizedText: string,
  title?: string,
  description?: string,
): { result: string; wasTruncated: boolean } {
  const selected = selectRelevantSections(normalizedText, input.prompt)
  const excerpt = truncateText(selected.selectedText, MAX_RESULT_CHARS)
  const lines = [
    `Prompt: ${input.prompt}`,
    '',
    `Fetched from: ${response.url}`,
    `Status: ${response.status} ${response.statusText}`,
    `Content-Type: ${contentType || '<unknown>'}`,
  ]

  if (title) {
    lines.push(`Title: ${title}`)
  }
  if (description) {
    lines.push(`Description: ${description}`)
  }

  lines.push(
    '',
    selected.selectionMode === 'prompt_relevant'
      ? 'Relevant excerpts for the prompt:'
      : 'Leading excerpt from the page:',
    '',
    excerpt.text || '<empty>',
  )

  if (excerpt.truncated) {
    lines.push('', `[truncated to first ${MAX_RESULT_CHARS} chars]`)
  }

  return {
    result: lines.join('\n'),
    wasTruncated: excerpt.truncated,
  }
}

export const webFetchTool: Tool<WebFetchToolInput, WebFetchToolOutput> = buildTool({
  name: 'WebFetch',
  description:
    'Fetch public web content from a URL, extract readable text, and return it with lightweight metadata. Prefer specialized tools for authenticated sites.',
  maxResultSizeChars: 40_000,
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'HTTP or HTTPS URL to fetch. Non-localhost HTTP URLs are upgraded to HTTPS.',
      },
      prompt: {
        type: 'string',
        description: 'Instruction describing what to extract or focus on from the fetched content.',
      },
    },
    required: ['url', 'prompt'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      bytes: { type: 'integer' },
      code: { type: 'integer' },
      codeText: { type: 'string' },
      result: { type: 'string' },
      durationMs: { type: 'integer' },
      url: { type: 'string' },
      contentType: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      wasTruncated: { type: 'boolean' },
    },
    required: [
      'bytes',
      'code',
      'codeText',
      'result',
      'durationMs',
      'url',
      'contentType',
      'wasTruncated',
    ],
    additionalProperties: false,
  },
  validate(input) {
    if (!input.url?.trim() || !input.prompt?.trim()) {
      return {
        ok: false,
        error: 'WebFetch requires both url and prompt',
      }
    }

    let parsed: URL
    try {
      parsed = new URL(input.url)
    } catch {
      return {
        ok: false,
        error: `Invalid URL: ${input.url}`,
      }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        error: 'WebFetch only supports http and https URLs',
      }
    }

    return { ok: true }
  },
  isReadOnly() {
    return true
  },
  async call(input): Promise<ToolResult<WebFetchToolOutput>> {
    const start = Date.now()
    const normalizedUrl = normalizeUrl(input.url)
    const fetched = await fetchWithRedirectHandling(normalizedUrl)

    if ('type' in fetched && fetched.type === 'redirect') {
      const result = buildRedirectMessage(
        normalizedUrl,
        fetched.location,
        fetched.response.status,
        input.prompt,
      )

      return {
        ok: true,
        output: {
          bytes: Buffer.byteLength(result, 'utf8'),
          code: fetched.response.status,
          codeText:
            REDIRECT_STATUS_TEXT[fetched.response.status] ??
            fetched.response.statusText,
          result,
          durationMs: Date.now() - start,
          url: normalizedUrl,
          contentType: fetched.response.headers.get('content-type') ?? '',
          wasTruncated: false,
        },
        summary: `Redirected from ${normalizedUrl}`,
      }
    }

    const rawText = await fetched.text()
    const contentType = fetched.headers.get('content-type') ?? ''
    const normalized = normalizeFetchedText(rawText, contentType)
    const rendered = buildResultText(
      input,
      fetched,
      contentType,
      normalized.text,
      normalized.title,
      normalized.description,
    )

    return {
      ok: true,
      output: {
        bytes: Buffer.byteLength(rawText, 'utf8'),
        code: fetched.status,
        codeText: fetched.statusText,
        result: rendered.result,
        durationMs: Date.now() - start,
        url: fetched.url,
        contentType,
        ...(normalized.title ? { title: normalized.title } : {}),
        ...(normalized.description ? { description: normalized.description } : {}),
        wasTruncated: rendered.wasTruncated,
      },
      summary: `Fetched ${fetched.url}`,
    }
  },
})
