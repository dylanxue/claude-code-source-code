import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProxyFetch,
  resolveLlmProxyConfig,
} from '../../src/llm/proxy.js'

test('resolveLlmProxyConfig prefers provider proxy settings over env', () => {
  const resolved = resolveLlmProxyConfig(
    {
      proxyUrl: 'http://provider-proxy.example:8080',
    },
    {
      HTTPS_PROXY: 'http://env-proxy.example:8080',
    },
  )

  assert.deepEqual(resolved, {
    proxyUrl: 'http://provider-proxy.example:8080',
    source: 'provider_config',
  })
})

test('resolveLlmProxyConfig falls back to conventional proxy env vars', () => {
  const resolved = resolveLlmProxyConfig(undefined, {
    HTTP_PROXY: 'http://env-proxy.example:8080',
  })

  assert.deepEqual(resolved, {
    proxyUrl: 'http://env-proxy.example:8080',
    source: 'env',
  })
})

test('createProxyFetch injects an undici dispatcher when proxy is configured', async () => {
  let capturedDispatcher: unknown
  const fetchImpl = (async (_input, init) => {
    capturedDispatcher = (init as RequestInit & { dispatcher?: unknown })
      .dispatcher
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const proxyFetch = createProxyFetch(
    { proxyUrl: 'http://proxy.example:8080' },
    {},
    fetchImpl,
  )

  await proxyFetch('https://api.example.test/v1/messages', {
    method: 'POST',
  })

  assert.ok(capturedDispatcher)
})
