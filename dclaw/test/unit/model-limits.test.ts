import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBuiltInModelLimits,
  getModelLimitsConfigPath,
  resolveModelLimits,
} from '../../src/llm/modelLimits.js'

test('built-in anthropic model limits follow Claude-style defaults', () => {
  assert.deepEqual(getBuiltInModelLimits('anthropic', 'claude-opus-4-6'), {
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
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

  assert.deepEqual(getBuiltInModelLimits('openai', 'kimi-k2.5'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
    maxOutputTokensUpperLimit: 32_768,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'bytedance-seed-code'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 32_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'dola-seed-2.0-pro'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'doubao-seed-2.0-code'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'doubao-seed-2.0-pro'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'doubao-seed-2.0-lite'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'seed-1-8-251228'), {
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    maxOutputTokensUpperLimit: 64_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'deepseek-chat'), {
    contextWindow: 131_072,
    maxOutputTokens: 4_096,
    maxOutputTokensUpperLimit: 8_192,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'deepseek-v3.2'), {
    contextWindow: 131_072,
    maxOutputTokens: 4_096,
    maxOutputTokensUpperLimit: 8_192,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'deepseek-reasoner'), {
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    maxOutputTokensUpperLimit: 65_536,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'glm-5.1'), {
    contextWindow: 204_800,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 131_072,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'glm-4.7-flash'), {
    contextWindow: 204_800,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 131_072,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'glm-4.6'), {
    contextWindow: 204_800,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 131_072,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'glm-4.5'), {
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 98_304,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'glm-4.5-airx'), {
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 98_304,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'glm-4.5-flash'), {
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 98_304,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'minimax-m2.7'), {
    contextWindow: 204_800,
    maxOutputTokens: 64_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('openai', 'minimax-m2.5'), {
    contextWindow: 204_800,
    maxOutputTokens: 64_000,
    maxOutputTokensUpperLimit: 128_000,
  })
})

test('built-in anthropic model limits support compatibility models', () => {
  assert.deepEqual(getBuiltInModelLimits('anthropic', 'bytedance-seed-code'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 32_000,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'seed-2-0-lite-260228'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'doubao-seed-2.0-code'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'doubao-seed-2.0-pro'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'doubao-seed-2.0-lite'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'kimi-k2.5'), {
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
    maxOutputTokensUpperLimit: 32_768,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'deepseek-reasoner'), {
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    maxOutputTokensUpperLimit: 65_536,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'deepseek-v3.2'), {
    contextWindow: 131_072,
    maxOutputTokens: 4_096,
    maxOutputTokensUpperLimit: 8_192,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'glm-5-turbo'), {
    contextWindow: 204_800,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 131_072,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'glm-4.5'), {
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    maxOutputTokensUpperLimit: 98_304,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'minimax-m2.7'), {
    contextWindow: 204_800,
    maxOutputTokens: 64_000,
    maxOutputTokensUpperLimit: 128_000,
  })

  assert.deepEqual(getBuiltInModelLimits('anthropic', 'minimax-m2.5'), {
    contextWindow: 204_800,
    maxOutputTokens: 64_000,
    maxOutputTokensUpperLimit: 128_000,
  })
})

test('resolveModelLimits applies config json overrides by provider and prefix', () => {
  const limits = resolveModelLimits(
    'openai',
    'gpt-5.4',
    {
      DCLAW_MODEL_LIMITS_JSON: JSON.stringify({
        providers: {
          openai: {
            'gpt-5': {
              contextWindow: 900_000,
              maxOutputTokens: 90_000,
              maxOutputTokensUpperLimit: 120_000,
            },
          },
        },
      }),
    },
  )

  assert.deepEqual(limits, {
    contextWindow: 900_000,
    maxOutputTokens: 90_000,
    maxOutputTokensUpperLimit: 120_000,
  })
})

test('resolveModelLimits applies environment overrides last', () => {
  const limits = resolveModelLimits(
    'anthropic',
    'claude-sonnet-4-6',
    {
      DCLAW_MAX_CONTEXT_TOKENS: '333333',
      DCLAW_MAX_OUTPUT_TOKENS: '44444',
      DCLAW_MAX_OUTPUT_TOKENS_UPPER_LIMIT: '55555',
    },
  )

  assert.deepEqual(limits, {
    contextWindow: 333_333,
    maxOutputTokens: 44_444,
    maxOutputTokensUpperLimit: 55_555,
  })
})

test('getModelLimitsConfigPath defaults to ~/.dclaw/model-limits.json', () => {
  assert.equal(
    getModelLimitsConfigPath({ HOME: '/tmp/example-home' } as NodeJS.ProcessEnv),
    '/tmp/example-home/.dclaw/model-limits.json',
  )
})

test('getModelLimitsConfigPath uses DCLAW_HOME when configured', () => {
  assert.equal(
    getModelLimitsConfigPath({
      HOME: '/tmp/example-home',
      DCLAW_HOME: '/tmp/dev-dclaw',
    } as NodeJS.ProcessEnv),
    '/tmp/dev-dclaw/model-limits.json',
  )
})
