import assert from 'node:assert/strict'
import test from 'node:test'
import type { StoredMemoryFile } from '../../src/memory/store.js'
import {
  filterMemoryFiles,
  getMemoryBodyLines,
  getMemoryDisplayName,
  getSelectedMemory,
  type MemoryMenuState,
} from '../../src/tui/views/MemoryMenu.js'

function memory(overrides: Partial<StoredMemoryFile>): StoredMemoryFile {
  return {
    path: '/tmp/memory/project/default.md',
    relativePath: 'project/default.md',
    content: '',
    body: 'Default memory body.',
    frontmatter: {
      name: 'Default Memory',
      description: 'Default memory description.',
      type: 'project',
      updated_at: '2026-04-18T08:00:00.000Z',
    },
    mtimeMs: 1,
    ...overrides,
  }
}

test('filterMemoryFiles searches memory metadata and body content', () => {
  const memories = [
    memory({
      relativePath: 'project/auth-policy.md',
      body: 'Require staging validation before auth changes.',
      frontmatter: {
        name: 'Auth Policy',
        description: 'Deployment policy for authentication changes.',
        type: 'project',
        updated_at: '2026-04-18T08:00:00.000Z',
      },
    }),
    memory({
      relativePath: 'feedback/terse.md',
      body: 'Keep answers short.',
      frontmatter: {
        name: 'Terse Replies',
        description: 'The user prefers concise answers.',
        type: 'feedback',
        updated_at: '2026-04-19T08:00:00.000Z',
      },
    }),
  ]

  assert.deepEqual(
    filterMemoryFiles(memories, 'concise').map(item => item.relativePath),
    ['feedback/terse.md'],
  )
  assert.deepEqual(
    filterMemoryFiles(memories, 'staging').map(item => item.relativePath),
    ['project/auth-policy.md'],
  )
  assert.deepEqual(
    filterMemoryFiles(memories, '').map(item => item.relativePath),
    ['feedback/terse.md', 'project/auth-policy.md'],
  )
})

test('memory menu helpers select active memories and body lines', () => {
  const memories = [
    memory({ relativePath: 'project/one.md' }),
    memory({
      relativePath: 'project/two.md',
      body: 'Line one\nLine two',
      frontmatter: null,
    }),
  ]
  const menu: MemoryMenuState = {
    activeRelativePath: 'project/two.md',
    isLoading: false,
    mode: 'view',
    searchQuery: '',
    selectedIndex: 0,
    viewScrollOffset: 0,
    memories,
  }

  const selected = getSelectedMemory(menu)

  assert.equal(selected?.relativePath, 'project/two.md')
  assert.equal(selected ? getMemoryDisplayName(selected) : '', 'project/two.md')
  assert.deepEqual(selected ? getMemoryBodyLines(selected) : [], [
    'Line one',
    'Line two',
  ])
})
