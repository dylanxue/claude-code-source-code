import type { MemoryManifestEntry } from './manifest.js'

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'of',
  'on',
  'or',
  'please',
  'the',
  'to',
  'we',
])

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token))
}

export function scoreMemoryManifestEntry(
  query: string,
  entry: MemoryManifestEntry,
): number {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    return 0
  }

  const haystack = [
    entry.name,
    entry.description,
    entry.type,
    entry.relativePath,
  ]
    .join(' ')
    .toLowerCase()

  let score = 0
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += 1
    }
  }

  return score
}

export function recallMemoryEntries(
  query: string,
  entries: MemoryManifestEntry[],
  limit = 5,
): MemoryManifestEntry[] {
  return entries
    .map(entry => ({
      entry,
      score: scoreMemoryManifestEntry(query, entry),
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }

      const aUpdatedAt = Date.parse(a.entry.updatedAt)
      const bUpdatedAt = Date.parse(b.entry.updatedAt)
      return (Number.isNaN(bUpdatedAt) ? b.entry.mtimeMs : bUpdatedAt) -
        (Number.isNaN(aUpdatedAt) ? a.entry.mtimeMs : aUpdatedAt)
    })
    .slice(0, limit)
    .map(result => result.entry)
}
