import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getMemoryDir, getMemoryEntrypointPath } from '../../src/memory/paths.js'
import {
  deleteMemoryFile,
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

test('deleteMemoryFile removes a workspace memory and prunes index links', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-store-delete-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    await ensureMemoryScaffold(workspaceRoot, env)
    const written = await writeMemoryFile({
      workspaceRoot,
      env,
      relativePath: 'project/delete-me.md',
      frontmatter: {
        name: 'Delete Me',
        description: 'Temporary memory for deletion.',
        type: 'project',
        updated_at: '2026-04-18T10:00:00.000Z',
      },
      body: 'This memory should be removed.',
    })
    await writeFile(
      getMemoryEntrypointPath(workspaceRoot, env),
      [
        '# Memory',
        '',
        '- [Delete Me](project/delete-me.md)',
        '- [Keep Me](project/keep-me.md)',
        '',
      ].join('\n'),
      'utf8',
    )

    const deleted = await deleteMemoryFile({
      workspaceRoot,
      env,
      relativePath: written.relativePath,
    })
    const entrypoint = await readFile(
      getMemoryEntrypointPath(workspaceRoot, env),
      'utf8',
    )

    assert.equal(deleted.didDelete, true)
    assert.equal(deleted.relativePath, 'project/delete-me.md')
    assert.deepEqual(await listMemoryFiles(workspaceRoot, env), [])
    assert.doesNotMatch(entrypoint, /project\/delete-me\.md/)
    assert.match(entrypoint, /project\/keep-me\.md/)
    await assert.rejects(
      deleteMemoryFile({
        workspaceRoot,
        env,
        relativePath: '../escape.md',
      }),
      /inside/,
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
