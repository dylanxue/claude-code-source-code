import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConfigAwareEnv,
  getWorkspaceConfigPath,
} from '../../src/cli/configFile.js'
import { getDclawConfigPath } from '../../src/session/paths.js'

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

test('buildConfigAwareEnv applies workspace then user config for env-like keys', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      MODEL_PROVIDER: 'anthropic',
      DCLAW_QUERY_TRACE: true,
      OPENAI_MODEL: 'workspace-model',
    })
    await writeJson(getDclawConfigPath(env), {
      MODEL_PROVIDER: 'openai-compatible',
      OPENAI_MODEL: 'user-model',
      OPENAI_API_STYLE: 'chat-completions',
    })

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)

    assert.equal(configuredEnv.MODEL_PROVIDER, 'openai-compatible')
    assert.equal(configuredEnv.DCLAW_QUERY_TRACE, 'true')
    assert.equal(configuredEnv.OPENAI_MODEL, 'user-model')
    assert.equal(configuredEnv.OPENAI_API_STYLE, 'chat-completions')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildConfigAwareEnv does not override existing environment variables', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = {
    ...process.env,
    HOME: homeDir,
    OPENAI_API_KEY: 'shell-key',
    MODEL_PROVIDER: 'anthropic',
  }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      MODEL_PROVIDER: 'openai-compatible',
      OPENAI_MODEL: 'workspace-model',
    })
    await writeJson(getDclawConfigPath(env), {
      MODEL_PROVIDER: 'openai',
      OPENAI_API_KEY: 'user-key',
    })

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)

    assert.equal(configuredEnv.MODEL_PROVIDER, 'anthropic')
    assert.equal(configuredEnv.OPENAI_API_KEY, 'shell-key')
    assert.equal(configuredEnv.OPENAI_MODEL, 'workspace-model')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildConfigAwareEnv allows config values to replace empty environment variables', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = {
    ...process.env,
    HOME: homeDir,
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '   ',
  }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      OPENAI_API_KEY: 'workspace-openai-key',
      ANTHROPIC_API_KEY: 'workspace-anthropic-key',
    })

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)

    assert.equal(configuredEnv.OPENAI_API_KEY, 'workspace-openai-key')
    assert.equal(configuredEnv.ANTHROPIC_API_KEY, 'workspace-anthropic-key')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildConfigAwareEnv allows workspace API keys and ignores DCLAW_HOME in config', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      OPENAI_API_KEY: 'workspace-key',
      DCLAW_HOME: '/tmp/ignored-home',
      MODEL_PROVIDER: 'openai-compatible',
    })

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)

    assert.equal(configuredEnv.OPENAI_API_KEY, 'workspace-key')
    assert.equal(configuredEnv.MODEL_PROVIDER, 'openai-compatible')
    assert.equal(configuredEnv.DCLAW_HOME, undefined)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildConfigAwareEnv stringifies structured JSON values', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getDclawConfigPath(env), {
      DCLAW_MODEL_LIMITS_JSON: {
        providers: {
          openai: {
            'gpt-config': {
              contextWindow: 123456,
              maxOutputTokens: 6543,
              maxOutputTokensUpperLimit: 7000,
            },
          },
        },
      },
    })

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)

    assert.deepEqual(JSON.parse(configuredEnv.DCLAW_MODEL_LIMITS_JSON!), {
      providers: {
        openai: {
          'gpt-config': {
            contextWindow: 123456,
            maxOutputTokens: 6543,
            maxOutputTokensUpperLimit: 7000,
          },
        },
      },
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
