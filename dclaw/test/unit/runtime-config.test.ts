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
import { createLlmClient } from '../../src/llm/client.js'
import { resolveLlmRuntimeConfig } from '../../src/llm/runtimeConfig.js'
import { getDclawConfigPath } from '../../src/session/paths.js'

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

test('resolveLlmRuntimeConfig prefers cli provider and model overrides', () => {
  const runtime = resolveLlmRuntimeConfig(
    {
      provider: 'anthropic',
      model: 'claude-test',
    },
    {
      DCLAW_PROVIDER: 'openai',
      ANTHROPIC_MODEL: 'claude-default',
    },
  )

  assert.equal(runtime.provider, 'anthropic')
  assert.equal(runtime.providerSource, 'cli')
  assert.equal(runtime.model, 'claude-test')
  assert.equal(runtime.modelSource, 'cli')
})

test('resolveLlmRuntimeConfig can infer provider from compatible env values', () => {
  const runtime = resolveLlmRuntimeConfig(
    {},
    {
      MODEL_PROVIDER: 'openai-compatible',
      OPENAI_MODEL: 'kimi-k2.5',
      OPENAI_BASE_URL: 'https://example.com/v1',
    },
  )

  assert.equal(runtime.provider, 'openai')
  assert.equal(runtime.providerSource, 'env')
  assert.equal(runtime.model, 'kimi-k2.5')
  assert.equal(runtime.modelSource, 'env')
  assert.equal(runtime.providerConfig.provider, 'openai')
  assert.equal(runtime.providerConfig.baseUrl, 'https://example.com/v1')
})

test('resolveLlmRuntimeConfig can use config.json-backed provider settings', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(
      getWorkspaceConfigPath(workspaceDir),
      {
        MODEL_PROVIDER: 'openai-compatible',
        OPENAI_BASE_URL: 'https://example.test/v1',
        OPENAI_MODEL: 'kimi-k2.5',
      },
    )
    await writeJson(
      getDclawConfigPath(env),
      {
        OPENAI_API_KEY: 'config-key',
        OPENAI_API_STYLE: 'chat-completions',
      },
    )

    const configured = await buildConfigAwareEnvWithSources(workspaceDir, env)
    const runtime = resolveLlmRuntimeConfig(
      {},
      configured.env,
      key => configured.keySources[key],
    )

    assert.equal(runtime.provider, 'openai')
    assert.equal(runtime.providerSource, 'workspace_config')
    assert.equal(runtime.model, 'kimi-k2.5')
    assert.equal(runtime.modelSource, 'workspace_config')
    assert.equal(runtime.providerConfig.provider, 'openai')
    assert.equal(runtime.providerConfig.baseUrl, 'https://example.test/v1')
    assert.equal(runtime.providerConfig.apiKey, 'config-key')
    assert.equal(runtime.providerConfig.apiStyle, 'chat-completions')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('createLlmClient uses the provided config-aware env for provider credentials', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-workspace-'))
  const env = {
    ...process.env,
    HOME: homeDir,
    OPENAI_API_KEY: '',
  }
  const originalFetch = globalThis.fetch

  try {
    await writeJson(getWorkspaceConfigPath(workspaceDir), {
      MODEL_PROVIDER: 'openai-compatible',
      OPENAI_API_KEY: 'config-key',
      OPENAI_MODEL: 'kimi-k2.5',
      OPENAI_API_STYLE: 'chat-completions',
    })

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'ok',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch

    const configuredEnv = await buildConfigAwareEnv(workspaceDir, env)
    const client = createLlmClient(undefined, configuredEnv)

    await client.createMessage({
      model: 'kimi-k2.5',
      messages: [],
    })

  } finally {
    globalThis.fetch = originalFetch
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
