import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { createMessage, createTextMessage, getTextContent, type Message } from '../../src/types/message.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createSession } from '../../src/session/store.js'
import { createSessionTask } from '../../src/tasks/store.js'
import { createToolContext } from '../helpers/toolContext.js'

class CapturingLlmClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createTextMessage('assistant', 'ok'),
    }
  }
}

function createAssistantToolUseMessage(name: string): Message {
  return createMessage('assistant', [
    {
      type: 'tool_use',
      id: `tool_${Math.random().toString(36).slice(2, 10)}`,
      name,
      input: {},
    },
  ])
}

test('QueryEngine appends a task tool reminder when task tracking is stale', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-tool-reminder-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-reminder',
      env,
    })
    await createSessionTask(
      session.sessionId,
      '/tmp/project',
      {
        subject: 'Implement task reminders',
        description: 'Add a runtime reminder when task tools go stale.',
      },
      env,
    )

    const client = new CapturingLlmClient()
    const registry = createDefaultToolRegistry()
    const engine = new QueryEngine({
      client,
      model: 'stub-model',
      modelLimitsEnv: env,
      systemPrompt: 'BASE SYSTEM PROMPT',
      toolRegistry: registry,
      toolContext: createToolContext({
        cwd: '/tmp/project',
        sessionId: session.sessionId,
        availableTools: registry.list().map(tool => tool.name),
      }),
      initialMessages: [
        createTextMessage('user', 'first request'),
        createTextMessage('assistant', 'first response'),
        createTextMessage('user', 'second request'),
        createTextMessage('assistant', 'second response'),
        createTextMessage('user', 'third request'),
        createTextMessage('assistant', 'third response'),
      ],
    })

    await engine.submitUserPrompt('continue')

    const request = client.requests[0]
    const systemPrompt = request?.systemPrompt ?? ''
    assert.equal(systemPrompt, 'BASE SYSTEM PROMPT')

    const reminderMessage = request?.messages.find(message => {
      return (
        message.role === 'user' &&
        getTextContent(message).startsWith('<system-reminder>')
      )
    })
    assert.ok(reminderMessage)
    const reminderText = getTextContent(reminderMessage)
    assert.match(reminderText, /# Task Tool Reminder/)
    assert.match(reminderText, /TaskCreate/)
    assert.match(reminderText, /TaskUpdate/)
    assert.match(reminderText, /Current task list:/)
    assert.match(reminderText, /#1 \[pending\] Implement task reminders/)

    const persistedMessages = engine.getMessages()
    assert.equal(
      persistedMessages.some(message =>
        getTextContent(message).includes('# Task Tool Reminder'),
      ),
      false,
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine skips the task tool reminder when task tools were used recently', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-tool-reminder-recent-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-reminder-recent',
      env,
    })
    await createSessionTask(
      session.sessionId,
      '/tmp/project',
      {
        subject: 'Implement task reminders',
        description: 'Add a runtime reminder when task tools go stale.',
      },
      env,
    )

    const client = new CapturingLlmClient()
    const registry = createDefaultToolRegistry()
    const engine = new QueryEngine({
      client,
      model: 'stub-model',
      modelLimitsEnv: env,
      systemPrompt: 'BASE SYSTEM PROMPT',
      toolRegistry: registry,
      toolContext: createToolContext({
        cwd: '/tmp/project',
        sessionId: session.sessionId,
        availableTools: registry.list().map(tool => tool.name),
      }),
      initialMessages: [
        createTextMessage('user', 'start'),
        createAssistantToolUseMessage('TaskUpdate'),
        createTextMessage('assistant', 'working'),
      ],
    })

    await engine.submitUserPrompt('continue')

    const request = client.requests[0]
    const reminderMessage = request?.messages.find(message => {
      return (
        message.role === 'user' &&
        getTextContent(message).startsWith('<system-reminder>')
      )
    })
    assert.equal(reminderMessage, undefined)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
