import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClaudeMdEntries } from '../../src/prompt/claudeMd.js'

test('loadClaudeMdEntries loads user CLAUDE.md from DCLAW_HOME', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-claude-md-'))
  const projectDir = join(dir, 'project')
  const dclawHome = join(dir, 'custom-dclaw-home')
  const env = {
    ...process.env,
    HOME: join(dir, 'fake-home'),
    DCLAW_HOME: dclawHome,
  }

  try {
    await mkdir(projectDir, { recursive: true })
    await mkdir(dclawHome, { recursive: true })
    await writeFile(
      join(dclawHome, 'CLAUDE.md'),
      'User instructions from DCLAW_HOME',
      'utf8',
    )
    await writeFile(join(projectDir, 'CLAUDE.md'), 'Project instructions', 'utf8')

    const entries = await loadClaudeMdEntries(projectDir, env)

    assert.equal(entries.length, 2)
    assert.equal(entries[0]?.source, 'user')
    assert.equal(entries[0]?.path, join(dclawHome, 'CLAUDE.md'))
    assert.equal(entries[0]?.content, 'User instructions from DCLAW_HOME')
    assert.equal(entries[1]?.source, 'project')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
