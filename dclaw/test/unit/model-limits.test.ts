import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalizeModelName,
  getBuiltInModelCapabilities,
  getBuiltInModelCatalogEntry,
  getBuiltInModelLimits,
  resolveModelCapabilities,
  resolveModelCatalogEntry,
  resolveModelLimits,
} from '../../src/llm/modelLimits.js'

test('built-in anthropic model limits follow Claude-style defaults', () => {
  assert.deepEqual(getBuiltInModelLimits('anthropic', 'claude-opus-4-6'), {
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'claude-3-5-sonnet-20241022'), {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    maxOutputTokensUpperLimit: 8_192,
  })
})

test('built-in openai model limits support modern responses models', () => {
  assert.deepEqual(getBuiltInModelLimits('openai', 'gpt-5.4'), {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'gpt-4.1-mini'), {
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    maxOutputTokensUpperLimit: 32_768,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'codex-mini-latest'), {
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    maxOutputTokensUpperLimit: 100_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'deepseek-reasoner'), {
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    maxOutputTokensUpperLimit: 65_536,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'deepseek-v4-pro'), {
    contextWindow: 1_048_576,
    maxOutputTokens: 100_000,
    maxOutputTokensUpperLimit: 100_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'glm-4.5-airx'), {
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 98_304,
  })
})

test('built-in model capabilities expose image/pdf support by provider family', () => {
  assert.deepEqual(getBuiltInModelCapabilities('anthropic', 'claude-sonnet-4-6'), {
    supportsImageInput: true,
    supportsPdfInput: true,
  })

  assert.deepEqual(getBuiltInModelCapabilities('anthropic', 'claude-opus-4.7'), {
    supportsImageInput: true,
    supportsPdfInput: true,
  })

  assert.deepEqual(getBuiltInModelCapabilities('openai', 'gpt-4.1-mini'), {
    supportsImageInput: true,
    supportsPdfInput: true,
  })

  assert.deepEqual(getBuiltInModelCapabilities('stub', 'stub'), {
    supportsImageInput: false,
    supportsPdfInput: false,
  })
})

test('built-in model capabilities distinguish multimodal and text-only compatibility families', () => {
  assert.deepEqual(
    getBuiltInModelCapabilities('openai', 'deepseek-chat'),
    { supportsImageInput: false, supportsPdfInput: false },
  )
  assert.deepEqual(
    getBuiltInModelCapabilities('openai', 'deepseek-v4-pro'),
    { supportsImageInput: false, supportsPdfInput: false },
  )
  assert.deepEqual(
    getBuiltInModelCapabilities('openai', 'glm-5.1'),
    { supportsImageInput: false, supportsPdfInput: false },
  )
  assert.deepEqual(
    getBuiltInModelCapabilities('openai', 'kimi-k2.5'),
    { supportsImageInput: true, supportsPdfInput: false },
  )
  assert.deepEqual(
    getBuiltInModelCapabilities('anthropic', 'claude-3-haiku'),
    { supportsImageInput: true, supportsPdfInput: false },
  )
})

test('built-in model catalog entry uses the longest prefix match', () => {
  assert.deepEqual(
    getBuiltInModelCatalogEntry('openai', 'gpt-5.4-pro-preview'),
    {
      match: 'gpt-5.4-pro',
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      maxOutputTokensUpperLimit: 128_000,
      supportsImageInput: true,
      supportsPdfInput: true,
    },
  )
})

test('built-in model catalog supports official Claude IDs and dotted OpenRouter-style aliases', () => {
  assert.equal(
    canonicalizeModelName('claude-opus-4.6'),
    'claude-opus-4-6',
  )
  assert.equal(
    canonicalizeModelName('anthropic/claude-opus-4.7'),
    'claude-opus-4-7',
  )
  assert.equal(
    canonicalizeModelName('anthropic/claude-sonnet-4.6'),
    'claude-sonnet-4-6',
  )

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'claude-opus-4.6'), {
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'claude-opus-4.7'), {
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'claude-sonnet-4.6'), {
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    maxOutputTokensUpperLimit: 64_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'deepseek/deepseek-v4-pro'), {
    contextWindow: 1_048_576,
    maxOutputTokens: 100_000,
    maxOutputTokensUpperLimit: 100_000,
  })
})

test('resolveModelLimits applies typed overrides by provider and prefix', () => {
  const limits = resolveModelLimits('openai', 'gpt-5.4', {
    overrides: {
      'gpt-5': {
        contextWindow: 900_000,
        maxOutputTokens: 90_000,
        maxOutputTokensUpperLimit: 120_000,
      },
    },
  })

  assert.deepEqual(limits, {
    contextWindow: 900_000,
    maxOutputTokens: 90_000,
    maxOutputTokensUpperLimit: 120_000,
  })
})

test('resolveModelLimits canonicalizes override keys for Claude-style dotted ids', () => {
  const limits = resolveModelLimits('openai', 'anthropic/claude-opus-4.7', {
    overrides: {
      'claude-opus-4.7': {
        contextWindow: 777_777,
        maxOutputTokens: 77_777,
        maxOutputTokensUpperLimit: 99_999,
      },
    },
  })

  assert.deepEqual(limits, {
    contextWindow: 777_777,
    maxOutputTokens: 77_777,
    maxOutputTokensUpperLimit: 99_999,
  })
})

test('resolveModelCatalogEntry merges built-in values with override fields', () => {
  assert.deepEqual(
    resolveModelCatalogEntry('openai', 'gpt-4.1-mini', {
      overrides: {
        'gpt-4.1-mini': {
          supportsImageInput: false,
          supportsPdfInput: false,
          contextWindow: 222_222,
          maxOutputTokens: 8_192,
          maxOutputTokensUpperLimit: 8_192,
        },
      },
    }),
    {
      match: 'gpt-4.1-mini',
      contextWindow: 222_222,
      maxOutputTokens: 8_192,
      maxOutputTokensUpperLimit: 8_192,
      supportsImageInput: false,
      supportsPdfInput: false,
    },
  )
})

test('resolveModelCapabilities supports model-specific overrides within the same provider', () => {
  assert.deepEqual(
    resolveModelCapabilities('openai', 'gpt-4.1-mini', {
      overrides: {
        'gpt-4.1-mini': {
          supportsImageInput: true,
          supportsPdfInput: true,
        },
        'gpt-5-mini-text': {
          supportsImageInput: false,
          supportsPdfInput: false,
        },
      },
    }),
    {
      supportsImageInput: true,
      supportsPdfInput: true,
    },
  )

  assert.deepEqual(
    resolveModelCapabilities('openai', 'gpt-5-mini-text', {
      overrides: {
        'gpt-4.1-mini': {
          supportsImageInput: true,
          supportsPdfInput: true,
        },
        'gpt-5-mini-text': {
          supportsImageInput: false,
          supportsPdfInput: false,
        },
      },
    }),
    {
      supportsImageInput: false,
      supportsPdfInput: false,
    },
  )
})

test('resolveModelLimits still applies environment token overrides last', () => {
  const limits = resolveModelLimits('anthropic', 'claude-sonnet-4-6', {
    env: {
      DCLAW_MAX_CONTEXT_TOKENS: '333333',
      DCLAW_MAX_OUTPUT_TOKENS: '44444',
      DCLAW_MAX_OUTPUT_TOKENS_UPPER_LIMIT: '55555',
    },
    overrides: {
      'claude-sonnet-4': {
        maxOutputTokens: 99_999,
      },
    },
  })

  assert.deepEqual(limits, {
    contextWindow: 333_333,
    maxOutputTokens: 44_444,
    maxOutputTokensUpperLimit: 55_555,
  })
})
