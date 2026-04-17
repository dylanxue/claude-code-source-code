import { evaluateCompactPressure } from '../../src/compact/pressure.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { computeContextStats } from '../../src/core/contextStats.js'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { createMessage, createTextMessage } from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

test('computeContextStats summarizes message counts, persisted tool results, and usage ratio', () => {
  const stats = computeContextStats(
    [
      createTextMessage('system', 'system prompt'),
      createTextMessage('user', 'hello'),
      createMessage('assistant', [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'Read',
          input: { file_path: '/tmp/example.txt' },
        },
      ]),
      createMessage('user', [
        {
          type: 'tool_result',
          toolUseId: 'tool_1',
          output: {
            type: 'persisted_tool_result',
            toolName: 'Read',
            summary: 'saved to disk',
            filepath: '/tmp/result.txt',
            originalSizeChars: 1234,
            preview: 'hello',
            truncated: true,
          },
        },
      ]),
    ],
    {
      modelLimits: {
        contextWindow: 4_096,
        maxOutputTokens: 1_024,
        maxOutputTokensUpperLimit: 2_048,
      },
      toolResultBudgetOptions: {
        defaultMaxResultSizeChars: 2_000,
        maxToolResultsPerTurnChars: 8_000,
        previewChars: 500,
      },
    },
  )

  assert.equal(stats.messageCount, 4)
  assert.equal(stats.systemMessageCount, 1)
  assert.equal(stats.userMessageCount, 2)
  assert.equal(stats.assistantMessageCount, 1)
  assert.equal(stats.toolUseCount, 1)
  assert.equal(stats.toolResultCount, 1)
  assert.equal(stats.persistedToolResultCount, 1)
  assert.equal(stats.modelContextWindow, 4_096)
  assert.equal(stats.estimatedInputBudgetTokens, 3_072)
  assert.ok((stats.contextUsageRatio ?? 0) > 0)
  assert.deepEqual(stats.toolResultBudget, {
    defaultMaxResultSizeChars: 2_000,
    maxToolResultsPerTurnChars: 8_000,
    previewChars: 500,
  })
})

test('QueryEngine exposes context stats using current model limits', () => {
  const engine = new QueryEngine({
    client: new StubLlmClient(),
    provider: 'openai',
    modelLimitsEnv: process.env,
    model: 'gpt-5',
    toolRegistry: new ToolRegistry(),
    toolContext: createToolContext(),
    initialMessages: [
      createTextMessage('user', 'hello'),
      createTextMessage('assistant', 'world'),
    ],
  })

  const stats = engine.getContextStats()
  assert.equal(stats.messageCount, 2)
  assert.equal(stats.userMessageCount, 1)
  assert.equal(stats.assistantMessageCount, 1)
  assert.ok((stats.modelContextWindow ?? 0) > 0)
  assert.ok((stats.estimatedInputBudgetTokens ?? 0) > 0)
  assert.ok(stats.toolResultBudget)
})

test('evaluateCompactPressure escalates from low to medium/high using shared context stats', () => {
  const low = evaluateCompactPressure({
    messageCount: 5,
    userMessageCount: 2,
    assistantMessageCount: 3,
    systemMessageCount: 0,
    toolUseCount: 0,
    toolResultCount: 0,
    persistedToolResultCount: 0,
    approxChars: 500,
    approxTokens: 125,
    modelContextWindow: 100_000,
    modelMaxOutputTokens: 4_000,
  })
  assert.equal(low.level, 'low')
  assert.equal(low.shouldCompact, false)
  assert.deepEqual(low.reasons, [])
  assert.equal(low.tokenUsage, 125)
  assert.equal(low.effectiveContextWindowTokens, 96_000)
  assert.equal(low.autoCompactThresholdTokens, 83_000)
  assert.equal(low.percentLeft, 100)
  assert.equal(low.isAboveWarningThreshold, false)

  const medium = evaluateCompactPressure({
    messageCount: 35,
    userMessageCount: 18,
    assistantMessageCount: 17,
    systemMessageCount: 0,
    toolUseCount: 0,
    toolResultCount: 0,
    persistedToolResultCount: 0,
    approxChars: 280_000,
    approxTokens: 70_000,
    modelContextWindow: 100_000,
    modelMaxOutputTokens: 4_000,
  })
  assert.equal(medium.level, 'medium')
  assert.equal(medium.shouldCompact, false)
  assert.equal(medium.percentLeft, 16)
  assert.equal(medium.isAboveWarningThreshold, true)
  assert.equal(medium.isAboveAutoCompactThreshold, false)
  assert.match(medium.reasons[0] ?? '', /close to auto-compact/)

  const high = evaluateCompactPressure({
    messageCount: 35,
    userMessageCount: 18,
    assistantMessageCount: 17,
    systemMessageCount: 0,
    toolUseCount: 10,
    toolResultCount: 10,
    persistedToolResultCount: 2,
    approxChars: 336_000,
    approxTokens: 84_000,
    modelContextWindow: 100_000,
    modelMaxOutputTokens: 4_000,
  })
  assert.equal(high.level, 'high')
  assert.equal(high.shouldCompact, true)
  assert.equal(high.percentLeft, 0)
  assert.equal(high.isAboveAutoCompactThreshold, true)
  assert.ok(high.reasons.length >= 1)
  assert.ok(
    high.reasons.some(reason => /reached the auto-compact threshold/.test(reason)),
  )
})
