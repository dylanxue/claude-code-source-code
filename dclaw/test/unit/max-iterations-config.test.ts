import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CLI_MAX_ITERATIONS,
  resolveMaxIterations,
} from '../../src/cli/maxIterationsConfig.js'

test('resolveMaxIterations returns the CLI default when nothing is configured', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-'))
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-home-'))

  try {
    const resolved = await resolveMaxIterations({ cwd }, { HOME: homeDir })

    assert.deepEqual(resolved, {
      maxIterations: DEFAULT_CLI_MAX_ITERATIONS,
      maxIterationsSource: 'default',
    })
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('resolveMaxIterations prefers env-backed configuration over direct config values', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-workspace-'))

  try {
    await mkdir(join(workspaceDir, '.dclaw'), { recursive: true })
    await writeFile(
      join(workspaceDir, '.dclaw', 'config.json'),
      JSON.stringify({
        maxIterations: 5,
        DCLAW_MAX_ITERATIONS: 11,
      }),
      'utf8',
    )

    const resolved = await resolveMaxIterations(
      { cwd: workspaceDir },
      { HOME: homeDir, DCLAW_MAX_ITERATIONS: '13' },
    )

    assert.deepEqual(resolved, {
      maxIterations: 13,
      maxIterationsSource: 'env',
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolveMaxIterations reads direct config values from user and workspace config files', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-workspace-'))

  try {
    await mkdir(join(workspaceDir, '.dclaw'), { recursive: true })
    await writeFile(
      join(workspaceDir, '.dclaw', 'config.json'),
      JSON.stringify({ maxIterations: 6 }),
      'utf8',
    )
    await mkdir(join(homeDir, '.dclaw'), { recursive: true })
    await writeFile(
      join(homeDir, '.dclaw', 'config.json'),
      JSON.stringify({ maxIterations: 10 }),
      'utf8',
    )

    const resolved = await resolveMaxIterations(
      { cwd: workspaceDir },
      { HOME: homeDir },
    )

    assert.deepEqual(resolved, {
      maxIterations: 10,
      maxIterationsSource: 'user_config',
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolveMaxIterations rejects invalid direct config values', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-workspace-'))
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-max-iterations-home-'))

  try {
    await mkdir(join(workspaceDir, '.dclaw'), { recursive: true })
    await writeFile(
      join(workspaceDir, '.dclaw', 'config.json'),
      JSON.stringify({ maxIterations: 0 }),
      'utf8',
    )

    await assert.rejects(
      () => resolveMaxIterations({ cwd: workspaceDir }, { HOME: homeDir }),
      /maxIterations must be a positive integer/,
    )
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(homeDir, { recursive: true, force: true })
  }
})
