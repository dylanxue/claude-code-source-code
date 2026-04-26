import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConfigAwareEnv,
  buildConfigAwareEnvWithSources,
  getWorkspaceConfigPath,
} from '../../src/cli/configFile.js'
import { loadResolvedLlmConfig } from '../../src/llm/config.js'
import { getDclawConfigPath } from '../../src/session/paths.js'

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

test('buildConfigAwareEnv applies non-provider DCLAW_* keys from config', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      DCLAW_QUERY_TRACE: true,
      DCLAW_MAX_ITERATIONS: 11,
    })
    await writeJson(getDclawConfigPath(env), {
      DCLAW_QUERY_TRACE: false,
    })

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)

    assert.equal(configuredEnv.DCLAW_QUERY_TRACE, 'false')
    assert.equal(configuredEnv.DCLAW_MAX_ITERATIONS, '11')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildConfigAwareEnv does not import provider-related keys from config', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      OPENAI_API_KEY: 'should-not-load',
      MODEL_PROVIDER: 'openai',
      DCLAW_OPENAI_BASE_URL: 'https://example.test/v1',
    })

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)

    assert.equal(configuredEnv.OPENAI_API_KEY, undefined)
    assert.equal(configuredEnv.MODEL_PROVIDER, undefined)
    assert.equal(configuredEnv.DCLAW_OPENAI_BASE_URL, undefined)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('loadResolvedLlmConfig merges user and workspace llm config with workspace override', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getDclawConfigPath(env), {
      llm: {
        defaultRuntime: 'user-default',
        providers: {
          'openai-default': {
            type: 'openai',
            apiKey: 'user-key',
            baseURL: 'https://user.example/v1',
            apiStyle: 'chat-completions',
          },
        },
        runtimes: {
          'user-default': {
            primary: {
              providerRef: 'openai-default',
              model: 'gpt-user',
            },
          },
        },
      },
    })
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      llm: {
        defaultRuntime: 'workspace-default',
        runtimes: {
          'workspace-default': {
            primary: {
              providerRef: 'openai-default',
              model: 'gpt-workspace',
            },
          },
        },
      },
    })

    const config = await loadResolvedLlmConfig(workspaceDir, env)

    assert.equal(config.defaultRuntime, 'workspace-default')
    assert.equal(config.defaultRuntimeSource, 'workspace_config')
    assert.equal(config.providers['openai-default']?.type, 'openai')
    assert.equal(config.runtimes['workspace-default']?.primary.model, 'gpt-workspace')
    assert.equal(config.runtimes['user-default']?.primary.model, 'gpt-user')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('loadResolvedLlmConfig parses flat global modelCatalogOverrides and merges them', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getDclawConfigPath(env), {
      llm: {
        modelCatalogOverrides: {
          'gpt-5': {
            maxOutputTokens: 99999,
          },
        },
      },
    })
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      llm: {
        modelCatalogOverrides: {
          'claude-opus-4.7': {
            contextWindow: 777777,
          },
        },
      },
    })

    const config = await loadResolvedLlmConfig(workspaceDir, env)

    assert.deepEqual(config.modelCatalogOverrides, {
      'gpt-5': {
        maxOutputTokens: 99999,
      },
      'claude-opus-4.7': {
        contextWindow: 777777,
      },
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('loadResolvedLlmConfig rejects provider secrets in workspace config', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      llm: {
        providers: {
          leak: {
            type: 'openai',
            apiKey: 'workspace-secret',
          },
        },
      },
    })

    await assert.rejects(
      () => loadResolvedLlmConfig(workspaceDir, env),
      /workspace llm\.providers\.leak\.apiKey is not allowed/,
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildConfigAwareEnvWithSources still tracks config-backed DCLAW_* sources', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-config-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-config-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      DCLAW_QUERY_TRACE: true,
    })

    const configured = await buildConfigAwareEnvWithSources(workspaceDir, env)

    assert.equal(configured.env.DCLAW_QUERY_TRACE, 'true')
    assert.equal(configured.keySources.DCLAW_QUERY_TRACE, 'workspace_config')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
