import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import { QueryLoopLlmError } from '../../src/core/queryErrors.js'
import {
  createFileQueryTraceSink,
  createQueryTraceFilePath,
} from '../../src/core/queryTrace.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  CreateMessageStreamCallbacks,
  LlmClient,
} from '../../src/llm/types.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import {
  createMessage,
  createTextMessage,
  getTextContent,
} from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

const EMPTY_TURN_REPAIR_SNIPPET =
  'Your previous response contained no user-visible text and no valid tool call.'

class EmptyThenToolThenTextClient implements LlmClient {
  readonly providerName = 'repair-test'
  readonly requests: CreateMessageRequest[] = []

  constructor(private readonly filePath: string) {}

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    if (this.requests.length === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'thinking',
            thinking: 'Need to inspect more files before answering.',
          },
        ]),
      }
    }

    if (this.requests.length === 2) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_repair_read',
            name: 'Read',
            input: {
              file_path: this.filePath,
            },
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'repair succeeded'),
    }
  }
}

class EmptyTwiceClient implements LlmClient {
  readonly providerName = 'repair-test'
  readonly requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createMessage('assistant', [
        {
          type: 'thinking',
          thinking: `Need to think more before answering (${this.requests.length}).`,
        },
      ]),
    }
  }
}

class RepeatingStreamClient implements LlmClient {
  readonly providerName = 'repair-test'
  readonly requests: CreateMessageRequest[] = []

  async createMessage(
    _request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    throw new Error('streaming path expected')
  }

  async createMessageStream(
    request: CreateMessageRequest,
    callbacks: CreateMessageStreamCallbacks,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    for (let index = 0; index < 32; index += 1) {
      callbacks.onTextDelta?.('你')
    }

    return {
      message: createTextMessage('assistant', 'should not complete'),
    }
  }
}

function hasRepairReminder(request: CreateMessageRequest): boolean {
  return request.messages.some(message =>
    getTextContent(message).includes(EMPTY_TURN_REPAIR_SNIPPET),
  )
}

test('query loop repairs an empty thinking-only turn without persisting the reminder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-query-loop-repair-'))
  const filePath = join(dir, 'repair-target.txt')
  const registry = createDefaultToolRegistry()
  const client = new EmptyThenToolThenTextClient(filePath)

  try {
    await writeFile(filePath, 'repair me', 'utf8')

    const result = await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'inspect the file')],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'default',
      }),
    })

    assert.equal(result.outputText, 'repair succeeded')
    assert.equal(client.requests.length, 3)
    assert.equal(hasRepairReminder(client.requests[0]!), false)
    assert.equal(hasRepairReminder(client.requests[1]!), true)
    assert.equal(hasRepairReminder(client.requests[2]!), false)
    assert.ok(
      result.addedMessages.every(
        message => !getTextContent(message).includes(EMPTY_TURN_REPAIR_SNIPPET),
      ),
    )
    assert.deepEqual(
      result.addedMessages.map(message =>
        message.content.map(block => block.type),
      ),
      [
        ['thinking'],
        ['tool_use'],
        ['tool_result'],
        ['text'],
      ],
    )
    assert.equal(await readFile(filePath, 'utf8'), 'repair me')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('query loop stops after one empty-turn repair attempt and returns a fallback message', async () => {
  const registry = createDefaultToolRegistry()
  const client = new EmptyTwiceClient()

  const result = await executeSingleTurn({
    client,
    messages: [createTextMessage('user', 'answer the question')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'default',
    }),
    maxIterations: 4,
  })

  assert.equal(client.requests.length, 2)
  assert.equal(hasRepairReminder(client.requests[0]!), false)
  assert.equal(hasRepairReminder(client.requests[1]!), true)
  assert.match(
    result.outputText,
    /no final text or valid tool call, even after a repair attempt/i,
  )
  assert.equal(result.assistantMessage.content[0]?.type, 'text')
  assert.ok(
    result.addedMessages.every(
      message => !getTextContent(message).includes(EMPTY_TURN_REPAIR_SNIPPET),
    ),
  )
})

test('query trace records empty-turn repair scheduling and failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-query-loop-repair-trace-'))
  const tracePath = createQueryTraceFilePath({
    ...process.env,
    DCLAW_HOME: join(dir, '.dclaw-home'),
  })
  const registry = createDefaultToolRegistry()
  const client = new EmptyTwiceClient()

  try {
    const queryTraceSink = await createFileQueryTraceSink(tracePath)

    const result = await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'answer the question')],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'default',
      }),
      maxIterations: 4,
      queryTraceSink,
    })

    assert.match(
      result.outputText,
      /no final text or valid tool call, even after a repair attempt/i,
    )

    const events = (await readFile(tracePath, 'utf8'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { event: string })
      .map(line => line.event)

    assert.deepEqual(events, [
      'turn.start',
      'iteration.start',
      'llm.request',
      'llm.response',
      'llm.empty_turn.detected',
      'llm.empty_turn.repair_scheduled',
      'iteration.start',
      'llm.request',
      'llm.response',
      'llm.empty_turn.detected',
      'llm.empty_turn.repair_failed',
      'turn.complete',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('query loop aborts streaming when estimated output approaches max tokens', async () => {
  const registry = createDefaultToolRegistry()
  const client = new RepeatingStreamClient()

  await assert.rejects(
    () =>
      executeSingleTurn({
        client,
        messages: [createTextMessage('user', 'answer in a stream')],
        toolRegistry: registry,
        toolContext: createToolContext({
          availableTools: registry.list().map(tool => tool.name),
          permissionMode: 'default',
        }),
        modelLimits: {
          contextWindow: 1_024,
          maxOutputTokens: 10,
          maxOutputTokensUpperLimit: 10,
        },
        streamHandlers: {},
      }),
    error => {
      assert.ok(error instanceof QueryLoopLlmError)
      assert.match(
        error.llmError.message,
        /estimated output reached .*guard threshold/i,
      )
      assert.equal(error.llmError.phase, 'during_stream')
      assert.equal(error.llmError.streamedTextChars, 9)
      return true
    },
  )
})

test('query trace records streaming output guard triggers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-query-loop-output-guard-'))
  const tracePath = createQueryTraceFilePath({
    ...process.env,
    DCLAW_HOME: join(dir, '.dclaw-home'),
  })
  const registry = createDefaultToolRegistry()
  const client = new RepeatingStreamClient()

  try {
    const queryTraceSink = await createFileQueryTraceSink(tracePath)

    await assert.rejects(
      () =>
        executeSingleTurn({
          client,
          messages: [createTextMessage('user', 'answer in a stream')],
          toolRegistry: registry,
          toolContext: createToolContext({
            availableTools: registry.list().map(tool => tool.name),
            permissionMode: 'default',
          }),
          modelLimits: {
            contextWindow: 1_024,
            maxOutputTokens: 10,
            maxOutputTokensUpperLimit: 10,
          },
          queryTraceSink,
          streamHandlers: {},
        }),
      error => error instanceof QueryLoopLlmError,
    )

    const events = (await readFile(tracePath, 'utf8'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { event: string })
      .map(line => line.event)

    assert.deepEqual(events, [
      'turn.start',
      'iteration.start',
      'compact.dry_run',
      'llm.request',
      'llm.text.delta',
      'llm.text.delta',
      'llm.text.delta',
      'llm.text.delta',
      'llm.text.delta',
      'llm.text.delta',
      'llm.text.delta',
      'llm.text.delta',
      'llm.text.delta',
      'llm.output_guard.triggered',
      'llm.error',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
