import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLlmClient } from '../../src/llm/client.js'
import { loadResolvedLlmConfig } from '../../src/llm/config.js'
import { resolveLlmRuntimeConfig } from '../../src/llm/runtimeConfig.js'
import { getWorkspaceConfigPath } from '../../src/cli/configFile.js'
import { getDclawConfigPath } from '../../src/session/paths.js'

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

test('resolveLlmRuntimeConfig allows an explicit runtime-local model override', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getDclawConfigPath(env), {
      llm: {
        providers: {
          anthro: {
            type: 'anthropic',
            apiKey: 'test-key',
          },
        },
        runtimes: {
          'anthropic-main': {
            primary: {
              providerRef: 'anthro',
              model: 'claude-default',
            },
          },
        },
      },
    })

    const config = await loadResolvedLlmConfig(workspaceDir, env)
    const runtime = resolveLlmRuntimeConfig(
      {
        runtime: 'anthropic-main',
        model: 'claude-test',
      },
      config,
      env,
    )

    assert.equal(runtime.runtimeName, 'anthropic-main')
    assert.equal(runtime.runtimeSource, 'cli')
    assert.equal(runtime.provider, 'anthropic')
    assert.equal(runtime.model, 'claude-test')
    assert.equal(runtime.modelSource, 'cli')
    assert.deepEqual(runtime.modelLimits, {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      maxOutputTokensUpperLimit: 64_000,
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolveLlmRuntimeConfig can use merged config.json-backed provider and runtime settings', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeJson(getDclawConfigPath(env), {
      llm: {
        providers: {
          compat: {
            type: 'openai',
            apiKey: 'config-key',
            baseURL: 'https://example.test/v1',
            apiStyle: 'codex-responses',
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
              providerRef: 'compat',
              model: 'kimi-k2.5',
            },
            imageFallback: {
              providerRef: 'compat',
              model: 'gpt-4.1-mini',
            },
          },
        },
      },
    })

    const config = await loadResolvedLlmConfig(workspaceDir, env)
    const runtime = resolveLlmRuntimeConfig({}, config, env)

    assert.equal(runtime.runtimeName, 'workspace-default')
    assert.equal(runtime.runtimeSource, 'workspace_config')
    assert.equal(runtime.provider, 'openai')
    assert.equal(runtime.providerConfig.provider, 'openai')
    assert.equal(runtime.providerConfig.baseUrl, 'https://example.test/v1')
    assert.equal(runtime.providerConfig.apiKey, 'config-key')
    assert.equal(runtime.providerConfig.apiStyle, 'codex-responses')
    assert.equal(runtime.model, 'kimi-k2.5')
    assert.equal(runtime.imageFallback?.provider, 'openai')
    assert.equal(runtime.imageFallback?.model, 'gpt-4.1-mini')
    assert.deepEqual(runtime.modelLimits, {
      contextWindow: 256_000,
      maxOutputTokens: 32_768,
      maxOutputTokensUpperLimit: 32_768,
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('resolveLlmRuntimeConfig falls back to stub runtime when llm config is absent', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const config = await loadResolvedLlmConfig(workspaceDir, env)
    const runtime = resolveLlmRuntimeConfig({}, config, env)

    assert.equal(runtime.provider, 'stub')
    assert.equal(runtime.runtimeName, undefined)
    assert.equal(runtime.model, undefined)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('createLlmClient uses resolved provider config directly', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-runtime-workspace-'))
  const env = { ...process.env, HOME: homeDir }
  const originalFetch = globalThis.fetch
  let authorizationHeader: string | null = null

  try {
    await writeJson(getDclawConfigPath(env), {
      llm: {
        providers: {
          direct: {
            type: 'openai',
            apiKey: 'config-key',
            baseURL: 'https://example.test/v1',
            apiStyle: 'chat-completions',
          },
        },
      },
    })

    const config = await loadResolvedLlmConfig(workspaceDir, env)
    const providerConfig = config.providers.direct
    if (!providerConfig || providerConfig.type !== 'openai') {
      throw new Error('expected openai provider profile')
    }

    globalThis.fetch = (async (_input, init) => {
      authorizationHeader =
        init && 'headers' in init && init.headers
          ? (init.headers as Record<string, string>).authorization ?? null
          : null

      return new Response(
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
      )
    }) as typeof fetch

    const client = createLlmClient(
      {
        provider: 'openai',
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseURL ?? 'https://api.openai.com/v1',
        apiStyle: providerConfig.apiStyle ?? 'responses',
      },
      env,
    )

    await client.createMessage({
      model: 'gpt-4.1-mini',
      messages: [],
    })

    assert.equal(authorizationHeader, 'Bearer config-key')
  } finally {
    globalThis.fetch = originalFetch
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('createLlmClient applies provider proxy config to fetch requests', async () => {
  const originalFetch = globalThis.fetch
  let hasDispatcher = false

  try {
    globalThis.fetch = (async (_input, init) => {
      hasDispatcher = Boolean(
        (init as RequestInit & { dispatcher?: unknown } | undefined)
          ?.dispatcher,
      )

      return new Response(
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
      )
    }) as typeof fetch

    const client = createLlmClient(
      {
        provider: 'openai',
        apiKey: 'config-key',
        baseUrl: 'https://example.test/v1',
        proxyUrl: 'http://proxy.example:8080',
        apiStyle: 'chat-completions',
      },
      {},
    )

    await client.createMessage({
      model: 'gpt-4.1-mini',
      messages: [],
    })

    assert.equal(hasDispatcher, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
