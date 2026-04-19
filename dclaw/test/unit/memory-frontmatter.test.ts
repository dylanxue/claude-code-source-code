import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatMemoryDocument,
  parseMemoryDocument,
} from '../../src/memory/frontmatter.js'

test('memory frontmatter round-trips quoted strings', () => {
  const content = formatMemoryDocument(
    {
      name: 'User says "ship it"',
      description: 'Remember the user preference: "ship small, ship often".',
      type: 'feedback',
      updated_at: '2026-04-18T10:30:00.000Z',
    },
    'Body text',
  )

  const parsed = parseMemoryDocument(content)

  assert.equal(parsed.frontmatter?.name, 'User says "ship it"')
  assert.equal(
    parsed.frontmatter?.description,
    'Remember the user preference: "ship small, ship often".',
  )
  assert.equal(parsed.body, 'Body text\n')
})
