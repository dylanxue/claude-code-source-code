import type { MemoryFrontmatter } from './frontmatter.js'
import type { MemoryManifestEntry } from './manifest.js'

export type MemoryUpgradeCandidate = {
  entry: MemoryManifestEntry
  reason: 'same_name' | 'similar_description'
}

const DESCRIPTION_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'from',
  'has',
  'have',
  'into',
  'its',
  'that',
  'the',
  'their',
  'them',
  'then',
  'this',
  'with',
])

function normalizeMemoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function getDescriptionTokens(value: string): string[] {
  return normalizeMemoryText(value)
    .split(' ')
    .filter(
      token =>
        token.length >= 3 && !DESCRIPTION_STOP_WORDS.has(token),
    )
}

function isDescriptionUpgradeMatch(
  incomingDescription: string,
  existingDescription: string,
): boolean {
  const incomingTokens = getDescriptionTokens(incomingDescription)
  const existingTokens = getDescriptionTokens(existingDescription)
  if (incomingTokens.length < 4 || existingTokens.length < 4) {
    return false
  }

  const existingSet = new Set(existingTokens)
  const overlap = incomingTokens.filter(token => existingSet.has(token)).length
  if (overlap < 4) {
    return false
  }

  return (
    overlap / incomingTokens.length >= 0.75 &&
    overlap / existingTokens.length >= 0.75
  )
}

export function findMemoryUpgradeCandidate(
  frontmatter: Pick<MemoryFrontmatter, 'name' | 'description' | 'type'>,
  entries: MemoryManifestEntry[],
  excludePath?: string,
): MemoryUpgradeCandidate | undefined {
  const normalizedIncomingName = normalizeMemoryText(frontmatter.name)
  const sameTypeEntries = entries.filter(
    entry =>
      entry.type === frontmatter.type &&
      entry.path !== excludePath,
  )

  const sameNameMatches = sameTypeEntries.filter(
    entry => normalizeMemoryText(entry.name) === normalizedIncomingName,
  )
  if (sameNameMatches.length === 1) {
    return {
      entry: sameNameMatches[0]!,
      reason: 'same_name',
    }
  }
  if (sameNameMatches.length > 1) {
    return undefined
  }

  const similarDescriptionMatches = sameTypeEntries.filter(entry =>
    isDescriptionUpgradeMatch(
      frontmatter.description,
      entry.description,
    ),
  )
  if (similarDescriptionMatches.length !== 1) {
    return undefined
  }

  return {
    entry: similarDescriptionMatches[0]!,
    reason: 'similar_description',
  }
}
