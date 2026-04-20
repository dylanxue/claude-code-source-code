import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadPromptMemoryContext,
  MAX_RECALLED_MEMORY_BYTES,
  MAX_RECALLED_MEMORY_COUNT,
  MAX_RECALLED_MEMORY_LINES,
} from '../../src/memory/prompt.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { writeMemoryFile } from '../../src/memory/store.js'

test('prompt memory recall caps injected memory count at five entries', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-prompt-limit-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    for (let index = 0; index < MAX_RECALLED_MEMORY_COUNT + 1; index += 1) {
      await writeMemoryFile({
        workspaceRoot,
        env,
        relativePath: `project/memory-${index}.md`,
        frontmatter: {
          name: `Migration Memory ${index}`,
          description: 'Postgres staging migration guidance.',
          type: 'project',
          updated_at: new Date(2026, 3, 20, 10, index, 0).toISOString(),
        },
        body: `Remember to validate postgres migration ${index} on staging.`,
      })
    }

    const memory = await loadPromptMemoryContext(
      workspaceRoot,
      'postgres staging migration',
      env,
      {
        client: new StubLlmClient(),
        model: 'stub-model',
      },
    )

    assert.equal(memory.manifestCount, MAX_RECALLED_MEMORY_COUNT + 1)
    assert.equal(memory.recalledEntries.length, MAX_RECALLED_MEMORY_COUNT)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('prompt memory recall truncates oversized memory bodies for prompt injection', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-prompt-truncate-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    await writeMemoryFile({
      workspaceRoot,
      env,
      relativePath: 'reference/long-memory.md',
      frontmatter: {
        name: 'Long Memory',
        description: 'Contains a long migration checklist.',
        type: 'reference',
        updated_at: '2026-04-20T10:00:00.000Z',
      },
      body: Array.from(
        { length: MAX_RECALLED_MEMORY_LINES + 20 },
        (_, index) => `l${index}`,
      ).join('\n'),
    })

    const lineLimited = await loadPromptMemoryContext(
      workspaceRoot,
      'migration checklist',
      env,
      {
        client: new StubLlmClient(),
        model: 'stub-model',
      },
    )
    assert.equal(lineLimited.recalledEntries.length, 1)
    assert.equal(lineLimited.recalledEntries[0]?.wasTruncated, true)
    assert.match(
      lineLimited.recalledEntries[0]?.content ?? '',
      new RegExp(`first ${MAX_RECALLED_MEMORY_LINES} lines`),
    )

    await writeMemoryFile({
      workspaceRoot,
      env,
      relativePath: 'reference/byte-memory.md',
      frontmatter: {
        name: 'Byte Limited Memory',
        description: 'Contains a byte-heavy migration note.',
        type: 'reference',
        updated_at: '2026-04-20T11:00:00.000Z',
      },
      body: 'postgres '.repeat(MAX_RECALLED_MEMORY_BYTES),
    })

    const byteLimited = await loadPromptMemoryContext(
      workspaceRoot,
      'byte-heavy migration note',
      env,
      {
        client: new StubLlmClient(),
        model: 'stub-model',
      },
    )
    const byteEntry = byteLimited.recalledEntries.find(
      entry => entry.name === 'Byte Limited Memory',
    )
    assert.equal(byteEntry?.wasTruncated, true)
    assert.match(
      byteEntry?.content ?? '',
      new RegExp(`${MAX_RECALLED_MEMORY_BYTES} byte limit`),
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
