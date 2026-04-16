import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLlmRuntimeConfig } from '../../src/llm/runtimeConfig.js'

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
  assert.equal(runtime.modelSource, 'config')
  assert.equal(runtime.providerConfig.provider, 'openai')
  assert.equal(runtime.providerConfig.baseUrl, 'https://example.com/v1')
})
