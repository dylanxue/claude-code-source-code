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
import {
  createImageBlock,
  createTextMessage,
} from '../../src/types/message.js'
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

class ToolThenAnswerClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  constructor(private readonly toolName: string) {}

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    if (this.requests.length === 1) {
      return {
        message: {
          role: 'assistant',
          id: 'msg_tool_use',
          createdAt: new Date().toISOString(),
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: this.toolName,
              input: {},
            },
          ],
        },
      }
    }

    return {
      message: createTextMessage('assistant', 'done'),
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
  assert.equal(
    await tool.prompt(createToolContext()),
    'Tool used to verify buildTool defaults.',
  )
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
  assert.match(readTool?.description ?? '', /absolute path/i)
  assert.match(readTool?.description ?? '', /use offset and limit/i)
  assert.match(readProperties?.offset?.description ?? '', /specific section/i)
  assert.match(readProperties?.limit?.description ?? '', /specific portion of a larger file/i)
})

test('query loop forwards dedicated long prompts for implemented core tools', async () => {
  const client = new CapturingLlmClient()
  const registry = createDefaultToolRegistry()
  const toolContext = createToolContext({
    availableTools: [
      'Bash',
      'Glob',
      'Grep',
      'Read',
      'Edit',
      'Write',
      'WebFetch',
      'AskUserQuestion',
      'ExitPlanMode',
    ],
    askUserQuestions: async () => ({ decision: 'Approve' }),
  })

  await executeSingleTurn({
    client,
    messages: [createTextMessage('user', 'hello')],
    toolRegistry: registry,
    toolContext,
  })

  const tools = client.requests[0]?.tools
  assert.ok(tools)

  const bash = tools.find(tool => tool.name === 'Bash')
  assert.match(bash?.description ?? '', /Prefer specialized tools over Bash/i)
  assert.match(bash?.description ?? '', /run_in_background/i)

  const glob = tools.find(tool => tool.name === 'Glob')
  assert.match(glob?.description ?? '', /find files by path pattern/i)
  assert.match(glob?.description ?? '', /If you need to search file contents, use Grep instead/i)

  const grep = tools.find(tool => tool.name === 'Grep')
  assert.match(grep?.description ?? '', /ALWAYS use Grep for content-search tasks/i)
  assert.match(grep?.description ?? '', /instead of running "grep" or "rg" through Bash/i)

  const read = tools.find(tool => tool.name === 'Read')
  assert.match(read?.description ?? '', /For larger files.*use offset and limit/i)
  assert.match(read?.description ?? '', /Partial reads are tracked as partial views/i)

  const edit = tools.find(tool => tool.name === 'Edit')
  assert.match(edit?.description ?? '', /must use the Read tool before editing/i)
  assert.match(edit?.description ?? '', /old_string matches multiple locations/i)

  const write = tools.find(tool => tool.name === 'Write')
  assert.match(write?.description ?? '', /If the target file already exists, you MUST use the Read tool first/i)
  assert.match(write?.description ?? '', /Prefer Edit for targeted modifications/i)

  const webFetch = tools.find(tool => tool.name === 'WebFetch')
  assert.match(webFetch?.description ?? '', /prompt should clearly describe what information to extract/i)
  assert.match(webFetch?.description ?? '', /GitHub pages or repository workflows, prefer Bash with gh/i)

  const askUserQuestion = tools.find(tool => tool.name === 'AskUserQuestion')
  assert.match(askUserQuestion?.description ?? '', /Users will always be able to select "Other"/i)
  assert.match(askUserQuestion?.description ?? '', /\(Recommended\)/i)
  assert.match(askUserQuestion?.description ?? '', /clarify requirements, constraints, or approach decisions/i)
  assert.match(askUserQuestion?.description ?? '', /Do not reference "the plan"/i)

  const exitPlanMode = tools.find(tool => tool.name === 'ExitPlanMode')
  assert.match(exitPlanMode?.description ?? '', /does not take the full plan content as input/i)
  assert.match(exitPlanMode?.description ?? '', /Do NOT use AskUserQuestion to ask "Is this plan okay\?"/i)
})

test('query loop forwards Claude Code style task tool prompts to the llm client', async () => {
  const client = new CapturingLlmClient()
  const registry = createDefaultToolRegistry()
  const toolContext = createToolContext({
    availableTools: [
      'EnterPlanMode',
      'TaskCreate',
      'TaskList',
      'TaskGet',
      'TaskUpdate',
    ],
    askUserQuestions: async () => ({ decision: 'Approve' }),
  })

  await executeSingleTurn({
    client,
    messages: [createTextMessage('user', 'hello')],
    toolRegistry: registry,
    toolContext,
  })

  const tools = client.requests[0]?.tools
  assert.ok(tools)

  const taskCreate = tools.find(tool => tool.name === 'TaskCreate')
  assert.match(taskCreate?.description ?? '', /Multi-step implementation work/i)
  assert.match(taskCreate?.description ?? '', /Check TaskList first/i)
  assert.match(taskCreate?.description ?? '', /fewer than 3 concrete tasks/i)
  assert.match(taskCreate?.description ?? '', /must start with 3 or more concrete tasks/i)
  assert.match(taskCreate?.description ?? '', /single TaskCreate call with the \*\*tasks\*\* array to seed 3-6 actionable tasks/i)
  assert.match(taskCreate?.description ?? '', /execution starts now/i)
  assert.match(taskCreate?.description ?? '', /no longer supports single-task creation/i)
  assert.match(taskCreate?.description ?? '', /automatically starts the first task/i)
  assert.match(taskCreate?.description ?? '', /Do not use this tool in plan mode/i)
  assert.equal(Boolean(taskCreate && 'anyOf' in taskCreate.inputSchema), false)

  const taskList = tools.find(tool => tool.name === 'TaskList')
  assert.match(taskList?.description ?? '', /Once implementation has started, use this tool before creating new tasks/i)

  const taskGet = tools.find(tool => tool.name === 'TaskGet')
  assert.match(taskGet?.description ?? '', /blockedBy/i)
  assert.match(taskGet?.description ?? '', /cancelled/i)

  const taskUpdate = tools.find(tool => tool.name === 'TaskUpdate')
  assert.match(taskUpdate?.description ?? '', /TaskGet.*before updating/i)
  assert.match(taskUpdate?.description ?? '', /Only mark a task as `completed`/i)
  assert.match(taskUpdate?.description ?? '', /Only one task may be `in_progress` at a time/i)
  assert.match(taskUpdate?.description ?? '', /cancelled/i)
  assert.match(taskUpdate?.description ?? '', /## Examples/i)

  const enterPlanMode = tools.find(tool => tool.name === 'EnterPlanMode')
  assert.match(enterPlanMode?.description ?? '', /no-implementation planning lock/i)
  assert.match(enterPlanMode?.description ?? '', /Do not enter plan mode merely because a task is non-trivial/i)
  assert.match(enterPlanMode?.description ?? '', /Plan mode is for plan creation only/i)
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

test('query loop preserves structured tool_result content for the next llm request', async () => {
  const registry = new ToolRegistry()
  registry.register(
    buildTool({
      name: 'RemoteImage',
      description: 'Returns an image as structured tool result content.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          contentKind: { type: 'string' },
          mediaType: { type: 'string' },
          result: { type: 'string' },
        },
        required: ['contentKind', 'mediaType', 'result'],
        additionalProperties: false,
      },
      async call() {
        return {
          ok: true,
          output: {
            contentKind: 'image',
            mediaType: 'image/png',
            result: 'Downloaded image content for analysis.',
          },
          content: [
            { type: 'text', text: 'Downloaded image content for analysis.' },
            createImageBlock('image/png', 'abc123'),
          ],
          summary: 'Fetched remote image',
        }
      },
      isReadOnly() {
        return true
      },
    }),
  )

  const client = new ToolThenAnswerClient('RemoteImage')

  await executeSingleTurn({
    client,
    messages: [createTextMessage('user', 'please use the RemoteImage tool')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['RemoteImage'],
    }),
  })

  const toolResultMessage = client.requests[1]?.messages.find(
    (message: (typeof client.requests)[number]['messages'][number]) =>
      message.role === 'user' &&
      message.content.some(block => block.type === 'tool_result'),
  )
  const block = toolResultMessage?.content[0]
  assert.ok(block && block.type === 'tool_result')
  assert.deepEqual(
    block.content?.map(
      (
        item: NonNullable<typeof block.content>[number],
      ) => item.type,
    ),
    ['text', 'image'],
  )
  const imageBlock = block.content?.[1]
  assert.ok(imageBlock && imageBlock.type === 'image')
  assert.equal(imageBlock.source.mediaType, 'image/png')
  assert.equal(block.rawOutput && typeof block.rawOutput, 'object')
})

test('query loop appends tool-generated messages to the next llm request', async () => {
  const registry = new ToolRegistry()
  registry.register(
    buildTool({
      name: 'LocalImage',
      description: 'Returns image content plus an additional user message.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          contentKind: { type: 'string' },
          mediaType: { type: 'string' },
        },
        required: ['contentKind', 'mediaType'],
        additionalProperties: false,
      },
      async call() {
        return {
          ok: true,
          output: {
            contentKind: 'image',
            mediaType: 'image/png',
          },
          content: [createImageBlock('image/png', 'abc123')],
          newMessages: [
            createTextMessage(
              'user',
              'Read image metadata: local image attached for analysis.',
            ),
          ],
          summary: 'Read local image',
        }
      },
      isReadOnly() {
        return true
      },
    }),
  )

  const client = new ToolThenAnswerClient('LocalImage')

  await executeSingleTurn({
    client,
    messages: [createTextMessage('user', 'please use the LocalImage tool')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['LocalImage'],
    }),
  })

  const followUpUserTextMessage = client.requests[1]?.messages.find(
    message =>
      message.role === 'user' &&
      message.content.length === 1 &&
      message.content[0]?.type === 'text' &&
      message.content[0].text.includes('Read image metadata'),
  )
  assert.ok(followUpUserTextMessage)

  const toolResultMessage = client.requests[1]?.messages.find(
    message =>
      message.role === 'user' &&
      message.content.some(block => block.type === 'tool_result'),
  )
  const block = toolResultMessage?.content[0]
  assert.ok(block && block.type === 'tool_result')
  assert.deepEqual(
    block.content?.map(
      (item: NonNullable<typeof block.content>[number]) => item.type,
    ),
    ['image'],
  )
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
