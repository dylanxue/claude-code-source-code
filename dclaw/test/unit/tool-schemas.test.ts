import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { validateJsonSchema } from '../../src/tools/schema.js'
import { buildTool } from '../../src/tools/types.js'
import { createTextMessage } from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

class CapturingLlmClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createTextMessage('assistant', 'schema capture ok'),
    }
  }
}

test('default tool registry exposes explicit input schemas for every tool', () => {
  const registry = createDefaultToolRegistry()

  for (const tool of registry.list()) {
    assert.ok(tool.inputSchema, `${tool.name} is missing inputSchema`)
    assert.equal(tool.inputSchema?.type, 'object')
    assert.equal(tool.inputSchema?.additionalProperties, false)
  }
})

test('default tool registry exposes explicit output schemas for every tool', () => {
  const registry = createDefaultToolRegistry()

  for (const tool of registry.list()) {
    assert.ok(tool.outputSchema, `${tool.name} is missing outputSchema`)
    assert.equal(tool.outputSchema?.type, 'object')
    assert.equal(tool.outputSchema?.additionalProperties, false)
  }

  const readTool = registry.list().find(tool => tool.name === 'Read')
  const readProperties = readTool?.outputSchema?.properties as
    | Record<string, { type?: string }>
    | undefined
  assert.equal(readProperties?.type?.type, 'string')
  assert.equal(readProperties?.isPartial?.type, 'boolean')

  const bashTool = registry.list().find(tool => tool.name === 'Bash')
  const bashProperties = bashTool?.outputSchema?.properties as
    | Record<string, { type?: string }>
    | undefined
  assert.equal(bashProperties?.sandboxMode?.type, 'string')
  assert.equal(bashProperties?.stdout?.type, 'string')
})

test('buildTool fills safe defaults for optional tool behavior', async () => {
  const tool = buildTool({
    name: 'DefaultedTool',
    description: 'Tool used to verify buildTool defaults.',
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

  assert.deepEqual(await tool.validate({}, createToolContext()), { ok: true })
  assert.equal(tool.isEnabled(createToolContext()), true)
  assert.equal(tool.isReadOnly({}), false)
  assert.deepEqual(
    tool.mapToolResult({
      ok: true,
      output: { ok: true },
      summary: 'done',
    }),
    { ok: true },
  )
})

test('validateJsonSchema supports anyOf and typed additionalProperties', () => {
  assert.deepEqual(
    validateJsonSchema(
      {
        originalFile: null,
        answers: {
          question_1: 'yes',
        },
      },
      {
        type: 'object',
        properties: {
          originalFile: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          answers: {
            type: 'object',
            additionalProperties: {
              type: 'string',
            },
          },
        },
        required: ['originalFile', 'answers'],
        additionalProperties: false,
      },
    ),
    { ok: true },
  )

  assert.deepEqual(
    validateJsonSchema(
      {
        answers: {
          question_1: 42,
        },
      },
      {
        type: 'object',
        properties: {
          answers: {
            type: 'object',
            additionalProperties: {
              type: 'string',
            },
          },
        },
        required: ['answers'],
        additionalProperties: false,
      },
    ),
    {
      ok: false,
      error: '$.answers.question_1 should be a string, got number',
    },
  )
})

test('query loop forwards declared tool schemas to the llm client', async () => {
  const client = new CapturingLlmClient()
  const registry = createDefaultToolRegistry()
  const toolContext = createToolContext({
    askUserQuestions: async () => ({}),
  })

  await executeSingleTurn({
    client,
    messages: [createTextMessage('user', 'hello')],
    toolRegistry: registry,
    toolContext,
  })

  const tools = client.requests[0]?.tools
  assert.ok(tools)
  const enabledToolCount = registry
    .list()
    .filter(tool => tool.isEnabled(toolContext)).length
  assert.equal(tools.length, enabledToolCount)

  const editTool = tools.find(tool => tool.name === 'Edit')
  assert.deepEqual(editTool?.inputSchema?.required, [
    'file_path',
    'old_string',
    'new_string',
  ])
  assert.equal(editTool?.inputSchema?.additionalProperties, false)

  const bashTool = tools.find(tool => tool.name === 'Bash')
  const bashProperties = bashTool?.inputSchema?.properties as
    | Record<string, { type?: string }>
    | undefined
  assert.equal(bashProperties?.command?.type, 'string')
  assert.equal(
    bashProperties?.dangerouslyDisableSandbox?.type,
    'boolean',
  )

  const readTool = tools.find(tool => tool.name === 'Read')
  const readProperties = readTool?.inputSchema?.properties as
    | Record<string, { description?: string }>
    | undefined
  assert.match(readTool?.description ?? '', /Read the whole file when it is reasonably small/)
  assert.match(readTool?.description ?? '', /search for specific content first/i)
  assert.match(readProperties?.offset?.description ?? '', /specific section/i)
  assert.match(readProperties?.limit?.description ?? '', /specific portion of a larger file/i)
})

test('query loop stores model-facing tool results separately from raw tool results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-tool-result-map-'))
  const filePath = join(dir, 'sample.txt')
  const registry = createDefaultToolRegistry()
  const toolContext = createToolContext({
    availableTools: ['Read'],
  })
  try {
    await writeFile(filePath, 'hello\n', 'utf8')

    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [createTextMessage('user', `tool:Read file_path=${filePath}`)],
      toolRegistry: registry,
      toolContext,
    })

    const toolResultMessage = result.toolResultMessages[0]
    const block = toolResultMessage?.content[0]
    assert.ok(block && block.type === 'tool_result')
    assert.equal(typeof block.output, 'object')
    assert.equal(typeof block.rawOutput, 'object')
    assert.ok(
      block.rawOutput &&
        typeof block.rawOutput === 'object' &&
        'ok' in block.rawOutput,
    )
    assert.ok(
      block.output &&
        typeof block.output === 'object' &&
        !('ok' in block.output),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('query loop rejects tool outputs that violate declared outputSchema', async () => {
  const registry = new ToolRegistry()
  registry.register(
    buildTool({
      name: 'Broken',
      description: 'Returns invalid output on purpose.',
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
            value: 123,
          },
          summary: 'broken result',
        }
      },
      isReadOnly() {
        return true
      },
    }),
  )

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [createTextMessage('user', 'tool:Broken')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['Broken'],
    }),
  })

  const toolResultMessage = result.toolResultMessages[0]
  const block = toolResultMessage?.content[0]
  assert.ok(block && block.type === 'tool_result')
  assert.deepEqual(block.output, {
    error:
      'Broken returned output that does not match outputSchema: $.value should be a string, got number',
  })
  assert.deepEqual(block.rawOutput, {
    ok: true,
    output: {
      value: 123,
    },
    summary: 'broken result',
  })
  assert.match(
    result.outputText,
    /does not match outputSchema: \$\.value should be a string, got number/,
  )
})
