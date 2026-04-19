import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getMemoryFilePath } from '../../src/memory/paths.js'
import { formatMemoryManifest, loadMemoryManifest } from '../../src/memory/manifest.js'
import { recallMemoryEntries } from '../../src/memory/recall.js'
import { ensureMemoryScaffold, writeMemoryFile } from '../../src/memory/store.js'

test('memory manifest loads valid memory files and sorts by updated_at', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-manifest-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    await ensureMemoryScaffold(workspaceRoot, env)
    await writeMemoryFile({
      workspaceRoot,
      env,
      relativePath: 'reference/latency-dashboard.md',
      frontmatter: {
        name: 'Latency Dashboard',
        description: 'Use the Grafana latency dashboard when touching request paths.',
        type: 'reference',
        updated_at: '2026-04-17T10:00:00.000Z',
      },
      body: 'Dashboard: grafana.internal/d/api-latency',
    })
    await writeMemoryFile({
      workspaceRoot,
      env,
      relativePath: 'project/migration-policy.md',
      frontmatter: {
        name: 'Migration Policy',
        description: 'Validate PostgreSQL migrations against a real staging database.',
        type: 'project',
        updated_at: '2026-04-18T10:00:00.000Z',
      },
      body: 'Avoid mock-only validation for migrations.',
    })
    await writeFile(
      getMemoryFilePath(workspaceRoot, 'invalid.md', env),
      '# not a managed memory file\n',
      'utf8',
    )

    const manifest = await loadMemoryManifest(workspaceRoot, env)
    const rendered = formatMemoryManifest(manifest)
    const recalled = recallMemoryEntries('postgres staging migration', manifest)

    assert.equal(manifest.length, 2)
    assert.equal(manifest[0]?.name, 'Migration Policy')
    assert.equal(manifest[1]?.name, 'Latency Dashboard')
    assert.match(rendered, /\[project\] project\/migration-policy\.md/)
    assert.equal(recalled.length, 1)
    assert.equal(recalled[0]?.name, 'Migration Policy')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
