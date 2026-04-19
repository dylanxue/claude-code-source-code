import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getMemoryDir, getMemoryEntrypointPath } from '../../src/memory/paths.js'
import {
  ensureMemoryScaffold,
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
} from '../../src/memory/store.js'

test('memory store creates scaffold and supports write/read/list', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-store-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const scaffold = await ensureMemoryScaffold(workspaceRoot, env)
    const written = await writeMemoryFile({
      workspaceRoot,
      env,
      frontmatter: {
        name: 'User Prefers Terse Responses',
        description: 'Keep answers short and skip long summaries.',
        type: 'feedback',
        updated_at: '2026-04-18T08:00:00.000Z',
      },
      body: 'The user prefers concise answers without padded recap sections.',
    })

    const entrypoint = await readFile(getMemoryEntrypointPath(workspaceRoot, env), 'utf8')
    const reread = await readMemoryFile(written.path, getMemoryDir(workspaceRoot, env))
    const files = await listMemoryFiles(workspaceRoot, env)

    assert.equal(scaffold.memoryDir, getMemoryDir(workspaceRoot, env))
    assert.match(entrypoint, /# Memory/)
    assert.ok(reread)
    assert.equal(reread?.frontmatter?.name, 'User Prefers Terse Responses')
    assert.equal(reread?.relativePath, 'user-prefers-terse-responses.md')
    assert.match(reread?.body ?? '', /concise answers/)
    assert.equal(files.length, 1)
    assert.equal(files[0]?.path, written.path)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('memory store supports nested memory files and excludes MEMORY.md from enumeration', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-store-nested-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    await ensureMemoryScaffold(workspaceRoot, env)
    await writeMemoryFile({
      workspaceRoot,
      env,
      relativePath: 'project/db-migration-policy.md',
      frontmatter: {
        name: 'DB Migration Policy',
        description: 'Run migrations against a real staging database before merge.',
        type: 'project',
        updated_at: '2026-04-18T09:00:00.000Z',
      },
      body: 'Never validate schema changes using mocks only.',
    })

    const files = await listMemoryFiles(workspaceRoot, env)

    assert.equal(files.length, 1)
    assert.equal(files[0]?.relativePath, 'project/db-migration-policy.md')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
