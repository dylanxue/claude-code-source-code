import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import {
  createFileQueryTraceSink,
  createQueryTraceFilePath,
  shouldEnableQueryTrace,
} from '../../src/core/queryTrace.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import {
  createMessage,
  createTextMessage,
} from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

test('query trace records the full tool-use event flow', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-query-trace-'))
  const filePath = join(dir, 'trace-target.txt')
  const tracePath = createQueryTraceFilePath({
    ...process.env,
    DCLAW_HOME: join(dir, '.dclaw-home'),
  })
  const registry = createDefaultToolRegistry()

  try {
    await writeFile(filePath, 'hello trace', 'utf8')
    const queryTraceSink = await createFileQueryTraceSink(tracePath)

    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [
        createTextMessage('user', `tool:Read file_path=${filePath}`),
      ],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'default',
      }),
      queryTraceSink,
    })

    assert.match(result.outputText, /"type": "text"/)

    const lines = (await readFile(tracePath, 'utf8'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { event: string })

    const events = lines.map(line => line.event)
    assert.deepEqual(events, [
      'turn.start',
      'iteration.start',
      'llm.request',
      'llm.response',
      'tool.use',
      'tool.validate.ok',
      'tool.permission.allowed',
      'tool.call.start',
      'tool.call.result',
      'iteration.tool_results',
      'iteration.start',
      'llm.request',
      'llm.response',
      'iteration.complete.no_tool_use',
      'turn.complete',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('query trace is controlled only by DCLAW_QUERY_TRACE', () => {
  assert.equal(shouldEnableQueryTrace({}), false)
  assert.equal(shouldEnableQueryTrace({ DCLAW_QUERY_TRACE: 'true' }), true)
  assert.equal(shouldEnableQueryTrace({ DCLAW_QUERY_TRACE: '1' }), true)
  assert.equal(shouldEnableQueryTrace({ DCLAW_QUERY_TRACE: 'false' }), false)
})

test('query trace summarizes reasoning and thinking blocks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-query-trace-'))
  const tracePath = createQueryTraceFilePath({
    ...process.env,
    DCLAW_HOME: join(dir, '.dclaw-home'),
  })
  const registry = createDefaultToolRegistry()
  let assistantMessageEvent:
    | {
        iteration: number
        id: string
        role: 'assistant'
        content: ReturnType<typeof createMessage>['content']
      }
    | undefined

  try {
    const queryTraceSink = await createFileQueryTraceSink(tracePath)

    const result = await executeSingleTurn({
      client: {
        providerName: 'stub',
        async createMessage() {
          return {
            message: createMessage('assistant', [
              {
                type: 'thinking',
                thinking: 'Need to inspect before answering.',
                signature: 'sig_trace_1',
              },
              {
                type: 'reasoning',
                id: 'rs_trace_1',
                summary: ['Plan the next step.'],
                encryptedContent: 'enc_trace_1',
                status: 'completed',
              },
              {
                type: 'text',
                text: 'final answer',
              },
            ]),
          }
        },
      },
      messages: [createTextMessage('user', 'hello')],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'default',
      }),
      queryTraceSink,
      streamHandlers: {
        onAssistantMessage(message) {
          assistantMessageEvent = message as typeof assistantMessageEvent
        },
      },
    })

    assert.equal(result.outputText, 'final answer')
    assert.deepEqual(
      assistantMessageEvent?.content.map(block => block.type),
      ['thinking', 'reasoning', 'text'],
    )

    const lines = (await readFile(tracePath, 'utf8'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as Record<string, unknown>)

    const llmResponse = lines.find(line => line.event === 'llm.response')
    assert.ok(llmResponse)
    assert.deepEqual(
      (llmResponse.data as { assistantMessage?: unknown } | undefined)?.assistantMessage,
      {
        id: result.assistantMessage.id,
        role: 'assistant',
        contentTypes: ['thinking', 'reasoning', 'text'],
        text: 'final answer',
        reasoning: [
          {
            id: 'rs_trace_1',
            summary: ['Plan the next step.'],
            status: 'completed',
            encryptedContentPresent: true,
          },
        ],
        thinking: [
          {
            type: 'thinking',
            thinking: 'Need to inspect before answering.',
            signaturePresent: true,
          },
        ],
        toolUses: [],
      },
    )
    assert.equal(
      (llmResponse.data as { toolUseCount?: unknown } | undefined)?.toolUseCount,
      0,
    )
    assert.equal(
      (llmResponse.data as { outputText?: unknown } | undefined)?.outputText,
      'final answer',
    )
    assert.deepEqual(
      (
        llmResponse.data as {
          fullAssistantMessage?: {
            content: Array<{ type: string }>
          }
        } | undefined
      )?.fullAssistantMessage?.content.map(block => block.type),
      ['thinking', 'reasoning', 'text'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('query trace records bash sandbox mode in tool results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-query-trace-'))
  const tracePath = createQueryTraceFilePath({
    ...process.env,
    DCLAW_HOME: join(dir, '.dclaw-home'),
  })
  const registry = createDefaultToolRegistry()

  try {
    const queryTraceSink = await createFileQueryTraceSink(tracePath)

    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [createTextMessage('user', 'tool:Bash command=pwd')],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'default',
      }),
      queryTraceSink,
    })

    assert.match(result.outputText, /"sandboxMode": "restricted"/)

    const lines = (await readFile(tracePath, 'utf8'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as Record<string, unknown>)

    const toolResultEvent = lines.find(line => line.event === 'tool.call.result')
    assert.ok(toolResultEvent)
    assert.equal(
      (toolResultEvent.data as { sandboxMode?: string } | undefined)?.sandboxMode,
      'restricted',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('query trace records llm.error when streaming fails after partial reasoning output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-query-trace-'))
  const tracePath = createQueryTraceFilePath({
    ...process.env,
    DCLAW_HOME: join(dir, '.dclaw-home'),
  })
  const registry = createDefaultToolRegistry()

  try {
    const queryTraceSink = await createFileQueryTraceSink(tracePath)

    await assert.rejects(
      () =>
        executeSingleTurn({
          client: {
            providerName: 'stub',
            async createMessage() {
              throw new Error('createMessage should not be used in this test')
            },
            async createMessageStream(_request, handlers) {
              handlers.onReasoningDelta?.({
                kind: 'thinking',
                text: 'Need to inspect before answering.',
              })
              throw new TypeError('terminated')
            },
          },
          messages: [createTextMessage('user', 'hello')],
          toolRegistry: registry,
          toolContext: createToolContext({
            availableTools: registry.list().map(tool => tool.name),
            permissionMode: 'default',
          }),
          queryTraceSink,
          streamHandlers: {},
        }),
      /terminated/,
    )

    const lines = (await readFile(tracePath, 'utf8'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as Record<string, unknown>)

    const events = lines.map(line => line.event)
    assert.deepEqual(events, [
      'turn.start',
      'iteration.start',
      'llm.request',
      'llm.reasoning.delta',
      'llm.error',
    ])

    const llmError = lines.find(line => line.event === 'llm.error')
    assert.ok(llmError)
    assert.deepEqual(llmError.data, {
      iteration: 1,
      streaming: true,
      phase: 'during_stream',
      kind: 'network',
      subtype: 'network_error',
      errorName: 'TypeError',
      message: 'terminated',
      streamedTextChars: 0,
      streamedReasoningChars: 33,
      lastReasoningDelta: {
        kind: 'thinking',
        text: 'Need to inspect before answering.',
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
