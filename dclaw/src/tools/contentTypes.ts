export const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
])

const TEXT_LIKE_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'tsv',
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'sh',
  'zsh',
  'bash',
  'sql',
  'toml',
  'ini',
  'cfg',
  'conf',
])

const PDF_EXTENSIONS = new Set(['pdf'])

const OFFICE_EXTENSIONS = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
])

const TEXT_LIKE_MEDIA_TYPE_PREFIXES = [
  'text/',
]

const TEXT_LIKE_MEDIA_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/x-www-form-urlencoded',
  'application/xhtml+xml',
  'application/atom+xml',
  'application/rss+xml',
  'application/markdown',
])

const PDF_MEDIA_TYPES = new Set([
  'application/pdf',
])

const OFFICE_MEDIA_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

export type ContentKind =
  | 'text'
  | 'image'
  | 'pdf'
  | 'office_document'
  | 'unknown_binary'

export function parseMediaType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function getPathExtension(value: string): string | undefined {
  const pathname = value.split(/[?#]/, 1)[0] ?? value
  const candidate = pathname.split('/').at(-1) ?? pathname
  const extension = candidate.split('.').at(-1)?.toLowerCase()
  return extension && extension !== candidate.toLowerCase() ? extension : undefined
}

export function isSupportedImageExtension(value: string): boolean {
  const extension = getPathExtension(value)
  return Boolean(extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension))
}

export function isSupportedImageMediaType(contentType: string): boolean {
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(parseMediaType(contentType))
}

export function isTextLikeExtension(value: string): boolean {
  const extension = getPathExtension(value)
  return Boolean(extension && TEXT_LIKE_EXTENSIONS.has(extension))
}

export function isPdfExtension(value: string): boolean {
  const extension = getPathExtension(value)
  return Boolean(extension && PDF_EXTENSIONS.has(extension))
}

export function isOfficeExtension(value: string): boolean {
  const extension = getPathExtension(value)
  return Boolean(extension && OFFICE_EXTENSIONS.has(extension))
}

export function isTextLikeMediaType(contentType: string): boolean {
  const mediaType = parseMediaType(contentType)
  return (
    TEXT_LIKE_MEDIA_TYPE_PREFIXES.some(prefix => mediaType.startsWith(prefix)) ||
    TEXT_LIKE_MEDIA_TYPES.has(mediaType)
  )
}

export function isPdfMediaType(contentType: string): boolean {
  return PDF_MEDIA_TYPES.has(parseMediaType(contentType))
}

export function isOfficeMediaType(contentType: string): boolean {
  return OFFICE_MEDIA_TYPES.has(parseMediaType(contentType))
}

export function isGenericBinaryMediaType(contentType: string): boolean {
  const mediaType = parseMediaType(contentType)
  return (
    mediaType === 'application/octet-stream' ||
    mediaType === 'binary/octet-stream'
  )
}

export function detectImageMediaTypeFromBuffer(
  buffer: Buffer,
): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image/gif'
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  return undefined
}

export function detectPdfFromBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
}

export function bufferLooksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024))
  for (const byte of sample) {
    if (byte === 0x00) {
      return true
    }
  }
  return false
}

export function classifyLocalFileContent(input: {
  filePath: string
  probe: Buffer
}): {
  kind: ContentKind
  detectedExtension?: string
  detectedMediaType?: string
} {
  const detectedExtension = getPathExtension(input.filePath)
  const detectedImageMediaType = detectImageMediaTypeFromBuffer(input.probe)

  if (detectedImageMediaType) {
    return {
      kind: 'image',
      detectedExtension,
      detectedMediaType: detectedImageMediaType,
    }
  }

  if (isPdfExtension(input.filePath) || detectPdfFromBuffer(input.probe)) {
    return {
      kind: 'pdf',
      detectedExtension,
      detectedMediaType: 'application/pdf',
    }
  }

  if (isOfficeExtension(input.filePath)) {
    return {
      kind: 'office_document',
      detectedExtension,
    }
  }

  if (bufferLooksBinary(input.probe) && !isTextLikeExtension(input.filePath)) {
    return {
      kind: 'unknown_binary',
      detectedExtension,
    }
  }

  return {
    kind: 'text',
    detectedExtension,
  }
}

export function classifyRemoteContent(input: {
  url: string
  contentType: string
}): {
  kind: ContentKind
  detectedExtension?: string
  detectedMediaType?: string
} {
  const detectedExtension = getPathExtension(input.url)
  const detectedMediaType = parseMediaType(input.contentType)

  if (isSupportedImageMediaType(input.contentType)) {
    return {
      kind: 'image',
      detectedExtension,
      detectedMediaType,
    }
  }

  if (detectedMediaType.startsWith('image/')) {
    return {
      kind: 'unknown_binary',
      detectedExtension,
      detectedMediaType,
    }
  }

  if (isPdfMediaType(input.contentType) || isPdfExtension(input.url)) {
    return {
      kind: 'pdf',
      detectedExtension,
      detectedMediaType: detectedMediaType || 'application/pdf',
    }
  }

  if (isOfficeMediaType(input.contentType) || isOfficeExtension(input.url)) {
    return {
      kind: 'office_document',
      detectedExtension,
      detectedMediaType: detectedMediaType || undefined,
    }
  }

  if (
    detectedMediaType.length > 0 &&
    !isTextLikeMediaType(input.contentType) &&
    isGenericBinaryMediaType(input.contentType)
  ) {
    return {
      kind: 'unknown_binary',
      detectedExtension,
      detectedMediaType,
    }
  }

  return {
    kind: 'text',
    detectedExtension,
    detectedMediaType: detectedMediaType || undefined,
  }
}
