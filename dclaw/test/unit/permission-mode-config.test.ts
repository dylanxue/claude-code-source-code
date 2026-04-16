import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkspaceConfigPath } from '../../src/cli/configFile.js'
import { resolvePermissionMode } from '../../src/cli/permissionModeConfig.js'
import { getDclawConfigPath } from '../../src/session/paths.js'

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

test('resolvePermissionMode falls back to default when no config is present', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-permission-home-'))
  const workspaceDir = await mkdtemp(
    join(tmpdir(), 'dclaw-permission-workspace-'),
  )

  try {
    const resolved = await resolvePermissionMode(
      { cwd: workspaceDir },
      { ...process.env, HOME: homeDir },
    )

    assert.deepEqual(resolved, {
      permissionMode: 'default',
      permissionModeSource: 'default',
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolvePermissionMode honors workspace config for plan mode', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-permission-home-'))
  const workspaceDir = await mkdtemp(
    join(tmpdir(), 'dclaw-permission-workspace-'),
  )

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      permissionMode: 'plan',
    })

    const resolved = await resolvePermissionMode(
      { cwd: workspaceDir },
      { ...process.env, HOME: homeDir },
    )

    assert.deepEqual(resolved, {
      permissionMode: 'plan',
      permissionModeSource: 'workspace',
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolvePermissionMode allows elevated workspace permission modes', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-permission-home-'))
  const workspaceDir = await mkdtemp(
    join(tmpdir(), 'dclaw-permission-workspace-'),
  )

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      permissionMode: 'accept-edits',
    })

    const resolved = await resolvePermissionMode(
      { cwd: workspaceDir },
      { ...process.env, HOME: homeDir },
    )

    assert.deepEqual(resolved, {
      permissionMode: 'accept-edits',
      permissionModeSource: 'workspace',
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolvePermissionMode honors user config before workspace config', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-permission-home-'))
  const workspaceDir = await mkdtemp(
    join(tmpdir(), 'dclaw-permission-workspace-'),
  )
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      permissionMode: 'plan',
    })
    await writeJson(getDclawConfigPath(env), {
      permissionMode: 'accept-edits',
    })

    const resolved = await resolvePermissionMode({ cwd: workspaceDir }, env)

    assert.deepEqual(resolved, {
      permissionMode: 'accept-edits',
      permissionModeSource: 'user',
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolvePermissionMode lets explicit CLI values override config files', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-permission-home-'))
  const workspaceDir = await mkdtemp(
    join(tmpdir(), 'dclaw-permission-workspace-'),
  )
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      permissionMode: 'plan',
    })
    await writeJson(getDclawConfigPath(env), {
      permissionMode: 'accept-edits',
    })

    const resolved = await resolvePermissionMode(
      {
        cwd: workspaceDir,
        permissionMode: 'bypass-permissions',
      },
      env,
    )

    assert.deepEqual(resolved, {
      permissionMode: 'bypass-permissions',
      permissionModeSource: 'cli',
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
