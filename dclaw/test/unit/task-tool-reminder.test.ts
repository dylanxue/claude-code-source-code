import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { createMessage, createTextMessage, getTextContent, type Message } from '../../src/types/message.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import type { AskUserQuestionHostResult } from '../../src/types/tool.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createSession } from '../../src/session/store.js'
import { getSessionExecutionTaskBoardPath } from '../../src/session/paths.js'
import {
  createExecutionTaskBoardForSession,
  loadActiveExecutionTaskBoardForSession,
  loadExecutionTaskBoardForSession,
} from '../../src/taskboard/store.js'
import type { TaskBoard } from '../../src/taskboard/types.js'
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

class StaticAnswerClient implements LlmClient {
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

class AskThenChatClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    if (this.requests.length === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'ask_1',
            name: 'AskUserQuestion',
            input: {
              questions: [
                {
                  id: 'clarify',
                  header: 'Clarify',
                  question: 'Which requirement should I prioritize?',
                  options: [
                    {
                      label: 'Engine',
                      description: 'Focus on the engine path first.',
                    },
                    {
                      label: 'UI',
                      description: 'Focus on the UI path first.',
                    },
                  ],
                },
              ],
            },
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'What would you like to clarify?'),
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
    await createExecutionTaskBoardForSession(
      session.sessionId,
      '/tmp/project',
      [
        {
          subject: 'Implement task reminders',
          description: 'Add a runtime reminder when task tools go stale.',
        },
        {
          subject: 'Verify reminder timing',
          description: 'Confirm the reminder appears after stale task tracking.',
        },
        {
          subject: 'Check task cleanup',
          description: 'Confirm unfinished tasks close when the turn ends.',
        },
      ],
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
    assert.equal(reminderMessage.runtimeAttachment?.type, 'task_reminder')
    assert.equal(reminderMessage.runtimeVisibility?.transcript, false)
    const reminderText = getTextContent(reminderMessage)
    assert.match(reminderText, /# Task Tool Reminder/)
    assert.match(reminderText, /TaskCreate/)
    assert.match(reminderText, /TaskUpdate/)
    assert.match(reminderText, /Current task list:/)
    assert.match(reminderText, /#1 \[in_progress\] Implement task reminders/)

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
    await createExecutionTaskBoardForSession(
      session.sessionId,
      '/tmp/project',
      [
        {
          subject: 'Implement task reminders',
          description: 'Add a runtime reminder when task tools go stale.',
        },
        {
          subject: 'Verify reminder timing',
          description: 'Confirm the reminder is skipped after recent task tool use.',
        },
        {
          subject: 'Check task cleanup',
          description: 'Confirm unfinished tasks close when the turn ends.',
        },
      ],
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

test('QueryEngine retries once before ending a turn with unfinished execution tasks, then cancels them', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-turn-cleanup-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-turn-cleanup',
      env,
    })
    const created = await createExecutionTaskBoardForSession(
      session.sessionId,
      '/tmp/project',
      [
        {
          subject: 'Implement task reminders',
          description: 'Add a runtime reminder when task tools go stale.',
        },
        {
          subject: 'Verify reminder timing',
          description: 'Confirm the reminder appears after stale task tracking.',
        },
        {
          subject: 'Check task cleanup',
          description: 'Confirm unfinished tasks close when the turn ends.',
        },
      ],
      env,
    )

    const client = new StaticAnswerClient()
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
    })

    await engine.submitUserPrompt('continue')

    assert.equal(client.requests.length, 2)
    const repairReminder = client.requests[1]?.messages.find(
      message =>
        message.runtimeAttachment?.type === 'task_reminder' &&
        message.runtimeAttachment.subtype === 'active_execution_continuation',
    )
    assert.ok(repairReminder)
    assert.equal(repairReminder.runtimeVisibility?.transcript, false)
    const repairRequestText = client.requests[1]?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''
    assert.match(repairRequestText, /You still have an active execution task list/i)

    const activeBoard = await loadActiveExecutionTaskBoardForSession(session.sessionId, env)
    assert.equal(activeBoard, null)

    const finalizedBoard = JSON.parse(
      await readFile(
        getSessionExecutionTaskBoardPath(session.sessionId, '/tmp/project', env),
        'utf8',
      ),
    ) as TaskBoard
    assert.equal(finalizedBoard.executionState, 'cancelled')
    assert.deepEqual(
      finalizedBoard.tasks.map(task => task.status),
      ['cancelled', 'cancelled', 'cancelled'],
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('AskUserQuestion handoff allows the turn to end without execution-turn repair and still cleans up tasks', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-turn-handoff-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-turn-handoff',
      env,
    })
    const created = await createExecutionTaskBoardForSession(
      session.sessionId,
      '/tmp/project',
      [
        {
          subject: 'Clarify engine path',
          description: 'Understand which engine detail matters first.',
        },
        {
          subject: 'Sketch UI interaction',
          description: 'Outline the browser interaction flow.',
        },
        {
          subject: 'Verify next steps',
          description: 'Decide what to do after clarification.',
        },
      ],
      env,
    )

    const client = new AskThenChatClient()
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
        askUserQuestions: async () =>
          ({
            answers: { clarify: 'Need more context' },
            action: 'respond_to_agent',
          }) satisfies AskUserQuestionHostResult,
      }),
    })

    await engine.submitUserPrompt('continue')

    assert.equal(client.requests.length, 2)
    const finalRequestText = client.requests[1]?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''
    assert.doesNotMatch(finalRequestText, /You still have an active execution task list/i)

    const activeBoard = await loadActiveExecutionTaskBoardForSession(session.sessionId, env)
    assert.equal(activeBoard, null)

    const finalizedBoard = JSON.parse(
      await readFile(
        getSessionExecutionTaskBoardPath(session.sessionId, '/tmp/project', env),
        'utf8',
      ),
    ) as TaskBoard
    assert.equal(finalizedBoard.executionState, 'cancelled')
    assert.deepEqual(
      finalizedBoard.tasks.map(task => task.status),
      ['cancelled', 'cancelled', 'cancelled'],
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
