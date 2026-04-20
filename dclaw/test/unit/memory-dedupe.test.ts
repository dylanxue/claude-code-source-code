import assert from 'node:assert/strict'
import test from 'node:test'
import { findMemoryUpgradeCandidate } from '../../src/memory/dedupe.js'
import type { MemoryManifestEntry } from '../../src/memory/manifest.js'

function createEntry(
  overrides: Partial<MemoryManifestEntry>,
): MemoryManifestEntry {
  return {
    name: 'Default Memory',
    description: 'Default memory description.',
    type: 'feedback',
    updatedAt: '2026-04-20T00:00:00.000Z',
    path: '/memory/feedback/default-memory.md',
    relativePath: 'feedback/default-memory.md',
    mtimeMs: Date.parse('2026-04-20T00:00:00.000Z'),
    ...overrides,
  }
}

test('findMemoryUpgradeCandidate prefers a same-name match within the same type', () => {
  const candidate = findMemoryUpgradeCandidate(
    {
      name: 'Terse Responses',
      description: 'User prefers terse responses with no padded recap.',
      type: 'feedback',
    },
    [
      createEntry({
        name: 'Terse Responses',
        description: 'User prefers concise replies.',
        path: '/memory/feedback/terse-responses.md',
      }),
      createEntry({
        name: 'Terse Responses',
        type: 'project',
        path: '/memory/project/terse-responses.md',
        relativePath: 'project/terse-responses.md',
      }),
    ],
  )

  assert.equal(candidate?.reason, 'same_name')
  assert.equal(candidate?.entry.path, '/memory/feedback/terse-responses.md')
})

test('findMemoryUpgradeCandidate falls back to a unique similar-description match', () => {
  const candidate = findMemoryUpgradeCandidate(
    {
      name: 'Brief Answers',
      description: 'User prefers terse responses and no padded recap.',
      type: 'feedback',
    },
    [
      createEntry({
        name: 'Answer Style',
        description: 'User prefers terse responses with no padded recap.',
        path: '/memory/feedback/answer-style.md',
        relativePath: 'feedback/answer-style.md',
      }),
    ],
  )

  assert.equal(candidate?.reason, 'similar_description')
  assert.equal(candidate?.entry.path, '/memory/feedback/answer-style.md')
})

test('findMemoryUpgradeCandidate stays conservative when similar-description matches are ambiguous', () => {
  const candidate = findMemoryUpgradeCandidate(
    {
      name: 'Brief Answers',
      description: 'User prefers terse responses and no padded recap.',
      type: 'feedback',
    },
    [
      createEntry({
        name: 'Answer Style',
        description: 'User prefers terse responses with no padded recap.',
        path: '/memory/feedback/answer-style.md',
        relativePath: 'feedback/answer-style.md',
      }),
      createEntry({
        name: 'Response Tone',
        description: 'User prefers terse responses with no recap padding.',
        path: '/memory/feedback/response-tone.md',
        relativePath: 'feedback/response-tone.md',
      }),
    ],
  )

  assert.equal(candidate, undefined)
})
