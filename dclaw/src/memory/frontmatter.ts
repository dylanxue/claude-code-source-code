export type MemoryType =
  | 'user'
  | 'feedback'
  | 'project'
  | 'reference'

export type MemoryFrontmatter = {
  name: string
  description: string
  type: MemoryType
  updated_at: string
}

export type ParsedMemoryDocument = {
  frontmatter: MemoryFrontmatter | null
  body: string
}

const FRONTMATTER_DELIMITER = '---'
const MEMORY_TYPES = new Set<MemoryType>([
  'user',
  'feedback',
  'project',
  'reference',
])

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed) as string
      } catch {
        return trimmed.slice(1, -1)
      }
    }
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseFrontmatterBlock(
  block: string,
): Partial<Record<keyof MemoryFrontmatter, string>> {
  const parsed: Partial<Record<keyof MemoryFrontmatter, string>> = {}

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim() as keyof MemoryFrontmatter
    const value = stripQuotes(line.slice(separatorIndex + 1))
    if (
      key === 'name' ||
      key === 'description' ||
      key === 'type' ||
      key === 'updated_at'
    ) {
      parsed[key] = value
    }
  }

  return parsed
}

export function isMemoryType(value: string): value is MemoryType {
  return MEMORY_TYPES.has(value as MemoryType)
}

export function normalizeMemoryFrontmatter(
  value: Partial<Record<keyof MemoryFrontmatter, string>>,
): MemoryFrontmatter | null {
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    typeof value.description !== 'string' ||
    value.description.trim().length === 0 ||
    typeof value.type !== 'string' ||
    !isMemoryType(value.type) ||
    typeof value.updated_at !== 'string' ||
    value.updated_at.trim().length === 0
  ) {
    return null
  }

  return {
    name: value.name.trim(),
    description: value.description.trim(),
    type: value.type,
    updated_at: value.updated_at.trim(),
  }
}

export function parseMemoryDocument(content: string): ParsedMemoryDocument {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return {
      frontmatter: null,
      body: normalized,
    }
  }

  const closingDelimiter = `\n${FRONTMATTER_DELIMITER}\n`
  const closingIndex = normalized.indexOf(closingDelimiter)
  if (closingIndex === -1) {
    return {
      frontmatter: null,
      body: normalized,
    }
  }

  const block = normalized.slice(
    FRONTMATTER_DELIMITER.length + 1,
    closingIndex,
  )
  const body = normalized
    .slice(closingIndex + closingDelimiter.length)
    .replace(/^\n/, '')

  return {
    frontmatter: normalizeMemoryFrontmatter(parseFrontmatterBlock(block)),
    body,
  }
}

export function formatMemoryDocument(
  frontmatter: MemoryFrontmatter,
  body: string,
): string {
  const normalizedBody = body.replace(/\r\n/g, '\n').trim()
  return [
    FRONTMATTER_DELIMITER,
    `name: ${JSON.stringify(frontmatter.name)}`,
    `description: ${JSON.stringify(frontmatter.description)}`,
    `type: ${frontmatter.type}`,
    `updated_at: ${frontmatter.updated_at}`,
    FRONTMATTER_DELIMITER,
    '',
    normalizedBody,
    '',
  ].join('\n')
}
