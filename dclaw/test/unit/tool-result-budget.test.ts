import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyToolResultBudget,
  deriveToolResultBudgetFromModelLimits,
  type PersistedToolResultOutput,
} from '../../src/core/toolResultBudget.js'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { buildTool } from '../../src/tools/types.js'
import {
  createTextMessage,
  createToolResultMessage,
  createToolUseMessage,
} from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

test('buildTool defaults maxResultSizeChars to infinity', () => {
  const tool = buildTool({
    name: 'DefaultsOnly',
    description: 'Tool used to verify maxResultSizeChars defaulting.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async call() {
      return {
        ok: true,
        output: { ok: true },
      }
    },
  })

  assert.equal(tool.maxResultSizeChars, Number.POSITIVE_INFINITY)
})

test('deriveToolResultBudgetFromModelLimits scales budgets with context size', () => {
  const small = deriveToolResultBudgetFromModelLimits({
    contextWindow: 4_096,
    maxOutputTokens: 1_024,
    maxOutputTokensUpperLimit: 2_048,
  })
  const large = deriveToolResultBudgetFromModelLimits({
    contextWindow: 1_048_576,
    maxOutputTokens: 32_768,
    maxOutputTokensUpperLimit: 32_768,
  })

  assert.ok(small.defaultMaxResultSizeChars < large.defaultMaxResultSizeChars)
  assert.ok(
    small.maxToolResultsPerTurnChars < large.maxToolResultsPerTurnChars,
  )
  assert.ok(small.previewChars <= large.previewChars)
})

test('applyToolResultBudget persists the largest outputs when the turn aggregate budget is exceeded', async () => {
  const dclawHome = await mkdtemp(join(tmpdir(), 'dclaw-budget-home-'))

  try {
    const first = createToolResultMessage('user', 'tool_1', 'a'.repeat(80))
    const second = createToolResultMessage('user', 'tool_2', 'b'.repeat(70))

    const result = await applyToolResultBudget(
      [first, second],
      new Map([
        ['tool_1', { toolName: 'First', maxResultSizeChars: 1_000 }],
        ['tool_2', { toolName: 'Second', maxResultSizeChars: 1_000 }],
      ]),
      {
        defaultMaxResultSizeChars: 1_000,
        maxToolResultsPerTurnChars: 100,
        previewChars: 16,
        env: {
          ...process.env,
          DCLAW_HOME: dclawHome,
        },
      },
    )

    assert.equal(result.replacements.length, 1)
    assert.equal(result.replacements[0]?.toolUseId, 'tool_1')

    const replacedBlock = result.messages[0]?.content[0]
    assert.ok(replacedBlock && replacedBlock.type === 'tool_result')
    assert.equal(
      (replacedBlock.output as PersistedToolResultOutput).type,
      'persisted_tool_result',
    )
    const persisted = await readFile(
      (replacedBlock.output as PersistedToolResultOutput).filepath,
      'utf8',
    )
    assert.equal(persisted, 'a'.repeat(80))

    const untouchedBlock = result.messages[1]?.content[0]
    assert.ok(untouchedBlock && untouchedBlock.type === 'tool_result')
    assert.equal(untouchedBlock.output, 'b'.repeat(70))
  } finally {
    await rm(dclawHome, { recursive: true, force: true })
  }
})

class ToolThenAnswerClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    if (this.requests.length === 1) {
      return {
        message: createToolUseMessage('assistant', 'Huge', {}),
      }
    }

    return {
      message: createTextMessage('assistant', 'done'),
    }
  }
}

class NamedToolThenAnswerClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  constructor(private readonly toolName: string) {}

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    if (this.requests.length === 1) {
      return {
        message: createToolUseMessage('assistant', this.toolName, {}),
      }
    }

    return {
      message: createTextMessage('assistant', 'done'),
    }
  }
}

test('query loop replaces oversized tool results before sending the next llm request', async () => {
  const registry = new ToolRegistry()
  registry.register(
    buildTool({
      name: 'Huge',
      description: 'Returns a large payload for budget testing.',
      maxResultSizeChars: 64,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      },
      async call() {
        return {
          ok: true,
          output: {
            value: 'x'.repeat(400),
          },
          summary: 'huge result',
        }
      },
      isReadOnly() {
        return true
      },
    }),
  )

  const client = new ToolThenAnswerClient()
  const dclawHome = await mkdtemp(join(tmpdir(), 'dclaw-query-budget-home-'))
  const originalDclawHome = process.env.DCLAW_HOME
  process.env.DCLAW_HOME = dclawHome

  try {
    const result = await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'please use the Huge tool')],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: ['Huge'],
      }),
    })

    assert.equal(result.outputText, 'done')
    assert.equal(client.requests.length, 2)

    const followupRequest = client.requests[1]
    const toolResultMessage = followupRequest?.messages.find(
      message =>
        message.role === 'user' &&
        message.content.some(block => block.type === 'tool_result'),
    )
    const block = toolResultMessage?.content[0]
    assert.ok(block && block.type === 'tool_result')
    assert.ok(block.rawOutput && typeof block.rawOutput === 'object')

    const persistedOutput = block.output as PersistedToolResultOutput
    assert.equal(persistedOutput.type, 'persisted_tool_result')
    assert.equal(persistedOutput.toolName, 'Huge')
    assert.match(persistedOutput.summary, /saved to disk/)

    const persistedFile = await readFile(persistedOutput.filepath, 'utf8')
    assert.match(persistedFile, /"value":/)
    assert.match(persistedFile, /xxxx/)

    const resultBlock = result.toolResultMessages[0]?.content[0]
    assert.ok(resultBlock && resultBlock.type === 'tool_result')
    assert.equal(
      (resultBlock.output as PersistedToolResultOutput).type,
      'persisted_tool_result',
    )
  } finally {
    process.env.DCLAW_HOME = originalDclawHome
    await rm(dclawHome, { recursive: true, force: true })
  }
})

test('query loop uses model-aware budgets to persist results more aggressively for smaller models', async () => {
  const registry = new ToolRegistry()
  registry.register(
    buildTool({
      name: 'Medium',
      description: 'Returns a medium payload for budget testing.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      },
      async call() {
        return {
          ok: true,
          output: {
            value: 'y'.repeat(6_000),
          },
          summary: 'medium result',
        }
      },
      isReadOnly() {
        return true
      },
    }),
  )

  const client = new NamedToolThenAnswerClient('Medium')
  const dclawHome = await mkdtemp(join(tmpdir(), 'dclaw-query-budget-small-'))
  const originalDclawHome = process.env.DCLAW_HOME
  process.env.DCLAW_HOME = dclawHome

  try {
    const result = await executeSingleTurn({
      client,
      model: 'tiny-test-model',
      modelLimits: {
        contextWindow: 4_096,
        maxOutputTokens: 1_024,
        maxOutputTokensUpperLimit: 2_048,
      },
      toolResultBudgetOptions: deriveToolResultBudgetFromModelLimits({
        contextWindow: 4_096,
        maxOutputTokens: 1_024,
        maxOutputTokensUpperLimit: 2_048,
      }),
      messages: [createTextMessage('user', 'please use the Medium tool')],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: ['Medium'],
      }),
    })

    const toolResultMessage = client.requests[1]?.messages.find(
      message =>
        message.role === 'user' &&
        message.content.some(block => block.type === 'tool_result'),
    )
    const block = toolResultMessage?.content[0]
    assert.ok(block && block.type === 'tool_result')
    assert.equal(
      (block.output as PersistedToolResultOutput).type,
      'persisted_tool_result',
    )
    assert.equal(result.outputText, 'done')
  } finally {
    process.env.DCLAW_HOME = originalDclawHome
    await rm(dclawHome, { recursive: true, force: true })
  }
})
