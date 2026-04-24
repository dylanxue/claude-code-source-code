import type { ToolResult } from '../../types/tool.js'
import { createImageBlock } from '../../types/message.js'
import {
  IMAGE_TARGET_RAW_SIZE,
  optimizeImageForModel,
} from '../../llm/imageProcessing.js'
import { runVisionSideQuery } from '../../llm/visionSideQuery.js'
import { buildTool, type Tool } from '../types.js'
import { getDefaultReadLimits } from './readLimits.js'
import { DESCRIPTION, PROMPT } from './webFetchPrompt.js'

const MAX_RESULT_CHARS = 16_000
const MAX_METADATA_CHARS = 300
const MAX_EXCERPTS = 6
const MAX_SECTION_CHARS = 1_800
const FETCH_TIMEOUT_MS = 20_000
const SUPPORTED_REMOTE_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])
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
  contentKind: 'text' | 'image'
  mediaType?: string
  title?: string
  description?: string
  wasTruncated: boolean
}

type RedirectResponse = {
  type: 'redirect'
  location: string
  response: Response
}

type FetchTimeout = {
  signal: AbortSignal
  dispose: () => void
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

function parseMediaType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
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

function isSupportedRemoteImageMediaType(contentType: string): boolean {
  return SUPPORTED_REMOTE_IMAGE_MEDIA_TYPES.has(parseMediaType(contentType))
}

function isImageLikeContentType(contentType: string): boolean {
  return parseMediaType(contentType).startsWith('image/')
}

function shouldUseVisionSideQuery(context: {
  supportsVisionInput?: boolean
  visionRuntime?: unknown
}): boolean {
  return context.supportsVisionInput === false && Boolean(context.visionRuntime)
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
  signal: AbortSignal,
  redirectLimit: number = 5,
): Promise<Response | RedirectResponse> {
  let currentUrl = inputUrl

  for (let attempt = 0; attempt <= redirectLimit; attempt += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        'user-agent': 'dclaw/0.1.0',
        accept:
          'text/html,application/xhtml+xml,application/json,text/plain,text/markdown,image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1',
      },
      signal,
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

function createFetchTimeout(timeoutMs: number): FetchTimeout {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  }
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

function buildImageResultText(
  input: WebFetchToolInput,
  response: Response,
  contentType: string,
  sourceBytes: number,
  attachedBytes: number,
  attachedMediaType: string,
  wasOptimized: boolean,
  estimatedTokens: number,
): string {
  const lines = [
    `Prompt: ${input.prompt}`,
    '',
    `Fetched from: ${response.url}`,
    `Status: ${response.status} ${response.statusText}`,
    `Content-Type: ${contentType || '<unknown>'}`,
    `Bytes: ${attachedBytes}`,
    '',
  ]

  if (wasOptimized) {
    lines.push(
      `Downloaded ${sourceBytes} source bytes and attached an optimized ${attachedMediaType} payload (${attachedBytes} bytes, ~${estimatedTokens} tokens) for the prompt.`,
    )
  } else {
    lines.push(
      `Downloaded image content for the prompt. The image is attached below as structured tool result content (~${estimatedTokens} tokens).`,
    )
  }

  return lines.join('\n')
}

function getContentLength(response: Response): number | undefined {
  const header = response.headers.get('content-length')
  if (!header) {
    return undefined
  }

  const parsed = Number(header)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

async function readRemoteImage(
  response: Response,
  maxImageSourceBytes: number,
  maxTokens: number,
): Promise<{
  bytes: number
  mediaType: string
  data: string
  sourceBytes: number
  wasOptimized: boolean
  estimatedTokens: number
}> {
  const contentType = response.headers.get('content-type') ?? ''
  const mediaType = parseMediaType(contentType)
  if (!isSupportedRemoteImageMediaType(contentType)) {
    throw new Error(
      `WebFetch only supports remote images with media types: ${[...SUPPORTED_REMOTE_IMAGE_MEDIA_TYPES].join(', ')}. Received ${mediaType || '<unknown>'}.`,
    )
  }

  const contentLength = getContentLength(response)
  if (
    typeof contentLength === 'number' &&
    contentLength > maxImageSourceBytes
  ) {
    throw new Error(
      `WebFetch image source is too large (${contentLength} bytes). Limit is ${maxImageSourceBytes} bytes.`,
    )
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxImageSourceBytes) {
    throw new Error(
      `WebFetch image source is too large (${buffer.length} bytes). Limit is ${maxImageSourceBytes} bytes.`,
    )
  }

  const optimizedImage = await optimizeImageForModel(buffer, mediaType, {
    maxTokens,
  })
  if (optimizedImage.buffer.length > IMAGE_TARGET_RAW_SIZE) {
    throw new Error(
      `WebFetch image could not be reduced to the model attachment limit (${IMAGE_TARGET_RAW_SIZE} bytes raw payload target).`,
    )
  }
  if (optimizedImage.estimatedTokens > maxTokens) {
    throw new Error(
      `WebFetch image could not be reduced to the image token budget (${optimizedImage.estimatedTokens}/${maxTokens} estimated tokens).`,
    )
  }

  return {
    bytes: optimizedImage.buffer.length,
    mediaType: optimizedImage.mediaType,
    data: optimizedImage.buffer.toString('base64'),
    sourceBytes: buffer.length,
    wasOptimized: optimizedImage.wasOptimized,
    estimatedTokens: optimizedImage.estimatedTokens,
  }
}

export const webFetchTool: Tool<WebFetchToolInput, WebFetchToolOutput> = buildTool({
  name: 'WebFetch',
  description: DESCRIPTION,
  // Keep text fetches budget-aware. Remote image fetches are self-bounded by
  // the source-image limit plus fetch-time optimization, and they return
  // structured content, so the aggregate tool-result budget skips them
  // entirely.
  maxResultSizeChars: 40_000,
  prompt() {
    return PROMPT
  },
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
      contentKind: { type: 'string' },
      mediaType: { type: 'string' },
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
      'contentKind',
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
  async call(input, context): Promise<ToolResult<WebFetchToolOutput>> {
    const start = Date.now()
    const normalizedUrl = normalizeUrl(input.url)
    const limits = getDefaultReadLimits()
    const fetchTimeout = createFetchTimeout(FETCH_TIMEOUT_MS)
    try {
      const fetched = await fetchWithRedirectHandling(normalizedUrl, fetchTimeout.signal)

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
            contentKind: 'text',
            wasTruncated: false,
          },
          summary: `Redirected from ${normalizedUrl}`,
        }
      }

      const contentType = fetched.headers.get('content-type') ?? ''
      if (isSupportedRemoteImageMediaType(contentType)) {
        const image = await readRemoteImage(
          fetched,
          limits.maxImageSourceBytes,
          limits.maxTokens,
        )
        const resultText = buildImageResultText(
          input,
          fetched,
          contentType,
          image.sourceBytes,
          image.bytes,
          image.mediaType,
          image.wasOptimized,
          image.estimatedTokens,
        )

        if (context.supportsVisionInput === false && !context.visionRuntime) {
          throw new Error(
            'WebFetch image requires either a vision-capable active runtime or a configured vision side query runtime.',
          )
        }

        if (shouldUseVisionSideQuery(context)) {
          const analysisText = await runVisionSideQuery({
            runtime: context.visionRuntime!,
            mediaType: image.mediaType,
            data: image.data,
            sourceLabel: `WebFetch ${fetched.url}`,
            currentUserRequest: context.currentUserRequest,
            toolUseIntent: context.toolUseIntent,
            queryTraceSink: context.queryTraceSink,
            iteration: context.currentIteration,
          })
          const fallbackResult = [
            resultText,
            '',
            'Vision side query analysis:',
            analysisText,
          ].join('\n')

          return {
            ok: true,
            output: {
              bytes: image.bytes,
              code: fetched.status,
              codeText: fetched.statusText,
              result: fallbackResult,
              durationMs: Date.now() - start,
              url: fetched.url,
              contentType,
              contentKind: 'image',
              mediaType: image.mediaType,
              wasTruncated: false,
            },
            content: [
              {
                type: 'text',
                text: fallbackResult,
              },
            ],
            summary: `Fetched image ${fetched.url} via vision side query`,
          }
        }

        return {
          ok: true,
          output: {
            bytes: image.bytes,
            code: fetched.status,
            codeText: fetched.statusText,
            result: resultText,
            durationMs: Date.now() - start,
            url: fetched.url,
            contentType,
            contentKind: 'image',
            mediaType: image.mediaType,
            wasTruncated: false,
          },
          content: [
            {
              type: 'text',
              text: resultText,
            },
            createImageBlock(image.mediaType, image.data),
          ],
          summary: `Fetched image ${fetched.url}`,
        }
      }

      if (isImageLikeContentType(contentType)) {
        throw new Error(
          `WebFetch only supports remote images with media types: ${[...SUPPORTED_REMOTE_IMAGE_MEDIA_TYPES].join(', ')}. Received ${parseMediaType(contentType) || '<unknown>'}.`,
        )
      }

      const rawText = await fetched.text()
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
          contentKind: 'text',
          ...(normalized.title ? { title: normalized.title } : {}),
          ...(normalized.description ? { description: normalized.description } : {}),
          wasTruncated: rendered.wasTruncated,
        },
        summary: `Fetched ${fetched.url}`,
      }
    } finally {
      fetchTimeout.dispose()
    }
  },
})
