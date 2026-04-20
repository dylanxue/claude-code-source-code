import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getMessagesAfterCompactBoundary } from '../../src/compact/boundaryMessage.js'
import {
  compactSession,
} from '../../src/compact/compactSession.js'
import { createCompactBoundaryMessage } from '../../src/compact/boundaryMessage.js'
import { createCompactSummaryMessage } from '../../src/compact/compactSummary.js'
import { computeContextStats } from '../../src/core/contextStats.js'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { loadSessionForResume } from '../../src/session/resume.js'
import {
  appendSessionMessages,
  createSession,
  loadSessionMeta,
  loadSessionMessages,
} from '../../src/session/store.js'
import { getSessionsDir } from '../../src/session/paths.js'
import {
  ensureTaskBoardPlanFile,
  getOrCreateTaskBoardForSession,
  updateTaskBoard,
} from '../../src/tasks/store.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { buildTool } from '../../src/tools/types.js'
import { createMessage, createTextMessage, getTextContent } from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { QueryLoopLlmError } from '../../src/core/queryErrors.js'

class CapturingLlmClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createTextMessage(
        'assistant',
        '<analysis>draft</analysis><summary>generated compact summary</summary>',
      ),
    }
  }
}

class FailingLlmClient implements LlmClient {
  readonly providerName = 'capture'

  async createMessage(): Promise<CreateMessageResponse> {
    throw new Error('compact summarize failed')
  }
}

class ToolThenFailingStreamClient implements LlmClient {
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
            id: 'tool_readme',
            name: 'EchoTool',
            input: {},
          },
        ]),
      }
    }

    throw new TypeError('terminated')
  }
}

test('QueryEngine starts from initialMessages when resuming', async () => {
  const initialMessages = [
    createTextMessage('user', 'earlier prompt'),
    createTextMessage('assistant', 'earlier answer'),
  ]

  const engine = new QueryEngine({
    client: new StubLlmClient(),
    toolRegistry: new ToolRegistry(),
    toolContext: createToolContext(),
    initialMessages,
  })

  const result = await engine.submitUserPrompt('follow up prompt')

  assert.equal(result.messages.length, 4)
  assert.equal(result.messages[0]?.content[0]?.type, 'text')
  assert.equal(result.messages[2]?.role, 'user')
  assert.match(result.outputText, /follow up prompt/)
})

test('QueryEngine resolves the system prompt from current runtime state', async () => {
  const client = new CapturingLlmClient()
  const engine = new QueryEngine({
    client,
    toolRegistry: new ToolRegistry(),
    toolContext: createToolContext(),
    systemPromptResolver: async state =>
      `permission=${state.permissionMode}; session=${state.sessionId ?? 'none'}; model=${state.model ?? 'default'}; prompt=${state.userPrompt}`,
  })

  engine.setSessionId('session-plan')
  engine.setPermissionMode('plan')
  engine.setModel('stub-model')

  await engine.submitUserPrompt('follow up prompt')

  assert.equal(
    client.requests[0]?.systemPrompt,
    'permission=plan; session=session-plan; model=stub-model; prompt=follow up prompt',
  )
})

test('QueryEngine appends messages returned by the turnCompleteHook', async () => {
  const client = new CapturingLlmClient()
  const engine = new QueryEngine({
    client,
    toolRegistry: new ToolRegistry(),
    toolContext: createToolContext(),
    turnCompleteHook: async state => [
      createTextMessage(
        'system',
        `memory hook ran for: ${state.userPrompt}`,
      ),
    ],
  })

  const result = await engine.submitUserPrompt('remember this preference')
  const lastMessage = result.messages.at(-1)

  assert.ok(lastMessage)
  assert.equal(lastMessage?.role, 'system')
  assert.match(getTextContent(lastMessage!), /memory hook ran/)
  assert.equal(result.appendedMessages.at(-1)?.role, 'system')
})

test('QueryEngine preserves completed turn messages when a later iteration fails', async () => {
  const client = new ToolThenFailingStreamClient()
  const registry = new ToolRegistry()
  registry.register(buildTool({
    name: 'EchoTool',
    description: 'Return a stable tool result.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
      additionalProperties: false,
    },
    isReadOnly() {
      return true
    },
    async call() {
      return {
        ok: true,
        output: { ok: true },
      }
    },
  }))

  const engine = new QueryEngine({
    client,
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['EchoTool'],
    }),
  })

  await assert.rejects(
    engine.submitUserPrompt('continue the work'),
    error => {
      assert.ok(error instanceof QueryLoopLlmError)
      return true
    },
  )

  const messages = engine.getMessages()
  assert.equal(messages.length, 3)
  assert.equal(messages[0]?.role, 'user')
  assert.equal(messages[1]?.role, 'assistant')
  assert.equal(messages[2]?.role, 'user')
  assert.equal(messages[2]?.content[0]?.type, 'tool_result')
})

test('session store persists transcript messages for resume', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-'))
  const env = { ...process.env, HOME: homeDir }
  const client = new CapturingLlmClient()

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'print',
      provider: 'stub',
      model: 'stub-model',
      env,
    })

    const messages = [
      createTextMessage('user', 'hello'),
      createTextMessage('assistant', 'world'),
    ]

    await appendSessionMessages(session.sessionId, messages, env)

    const storedMessages = await loadSessionMessages(session.sessionId, env)
    const resumed = await loadSessionForResume(session.sessionId, env)

    assert.equal(storedMessages.length, 2)
    assert.equal(resumed?.meta.sessionId, session.sessionId)
    assert.equal(resumed?.meta.cwd, '/tmp/project')
    assert.equal(resumed?.messages.length, 2)
    assert.equal(resumed?.messages[1]?.role, 'assistant')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession appends a compact boundary and summary inside the current session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-compact-'))
  const env = { ...process.env, HOME: homeDir }
  const client = new CapturingLlmClient()

  try {
    const source = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      env,
    })
    const sourceMessages = [
      createTextMessage('user', 'first question'),
      createTextMessage('assistant', 'first answer'),
    ]
    await appendSessionMessages(source.sessionId, sourceMessages, env)

    const result = await compactSession({
      sourceSessionId: source.sessionId,
      messages: sourceMessages,
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      reason: 'user requested /compact',
      instructionText: 'keep the important details',
      contextStats: computeContextStats(sourceMessages),
      client,
      env,
    })

    const sourceMeta = await loadSessionMeta(source.sessionId, env)
    const sessionMessages = await loadSessionMessages(source.sessionId, env)
    const visibleMessages = getMessagesAfterCompactBoundary(sessionMessages)
    const sessionDirs = await readdir(getSessionsDir(env))

    assert.ok(sourceMeta)
    assert.equal(result.session.sessionId, source.sessionId)
    assert.equal(sessionDirs.length, 1)
    assert.deepEqual(sessionDirs, [source.sessionId])
    assert.equal(sessionMessages.length, 4)
    assert.equal(sessionMessages[2]?.compactBoundary?.boundaryId, result.boundary.boundaryId)
    assert.equal(sessionMessages[3]?.id, result.summaryMessage.id)
    assert.equal(visibleMessages.length, 1)
    assert.equal(visibleMessages[0]?.id, result.summaryMessage.id)
    assert.equal(client.requests.length, 1)
    assert.match(
      client.requests[0]?.systemPrompt ?? '',
      /You are generating a compact summary/,
    )
    const summarizePrompt =
      client.requests[0]?.messages[0]?.content[0]?.type === 'text'
        ? client.requests[0].messages[0].content[0].text
        : ''
    assert.match(summarizePrompt, /## Transcript/)
    const summaryText =
      sessionMessages[3]?.content[0]?.type === 'text'
        ? sessionMessages[3].content[0].text
        : ''
    assert.match(summaryText, /Compact summary from earlier in this session\./)
    assert.match(summaryText, /boundary: manual compact boundary compact_/)
    assert.match(summaryText, /generated compact summary/)
    assert.doesNotMatch(summaryText, /Transcript summary:/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession summarize prompt stays focused on transcript even when planning is active', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-compact-plan-'))
  const env = { ...process.env, HOME: homeDir }
  const client = new CapturingLlmClient()

  try {
    const source = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      env,
    })
    const board = await ensureTaskBoardPlanFile(
      await getOrCreateTaskBoardForSession(source.sessionId, '/tmp/project', env),
      env,
    )
    await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        mode: 'active',
        tasks: [
          {
            id: '1',
            subject: 'Review auth flow',
            description: 'Review auth flow before updating the planning doc',
            activeForm: 'Reviewing auth flow',
            status: 'in_progress',
            blocks: [],
            blockedBy: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        currentStep: 'Reviewing auth flow',
        updatedAt: new Date().toISOString(),
      }),
      env,
    )
    const sourceMessages = [
      createTextMessage('user', 'please compact this planning session'),
      createTextMessage('assistant', 'still refining the plan'),
    ]

    const result = await compactSession({
      sourceSessionId: source.sessionId,
      messages: sourceMessages,
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      reason: 'user requested /compact',
      contextStats: computeContextStats(sourceMessages),
      client,
      env,
    })

    const sessionMessages = await loadSessionMessages(result.session.sessionId, env)
    const summaryMessage = sessionMessages.at(-1)
    const summaryText =
      summaryMessage?.content[0]?.type === 'text'
        ? summaryMessage.content[0].text
        : ''

    assert.match(summaryText, /generated compact summary/)
    const summarizePrompt =
      client.requests[0]?.messages[0]?.content[0]?.type === 'text'
        ? client.requests[0].messages[0].content[0].text
        : ''
    assert.doesNotMatch(summarizePrompt, /## Plan Attachment/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})


test('compactSession leaves the original session untouched when summarization fails', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-compact-fail-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const source = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      env,
    })
    const sourceMessages = [
      createTextMessage('user', 'first question'),
      createTextMessage('assistant', 'first answer'),
    ]
    await appendSessionMessages(source.sessionId, sourceMessages, env)

    await assert.rejects(
      compactSession({
        sourceSessionId: source.sessionId,
        messages: sourceMessages,
        cwd: '/tmp/project',
        provider: 'stub',
        model: 'stub-model',
        trigger: 'manual',
        reason: 'user requested /compact',
        client: new FailingLlmClient(),
        env,
      }),
      /compact summarize failed/,
    )

    const sourceMeta = await loadSessionMeta(source.sessionId, env)
    const sourceMessagesAfterFailure = await loadSessionMessages(source.sessionId, env)
    const sessionDirs = await readdir(getSessionsDir(env))

    assert.ok(sourceMeta)
    assert.equal(sourceMessagesAfterFailure.length, sourceMessages.length)
    assert.deepEqual(sessionDirs, [source.sessionId])
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine injects post-compact file and plan attachments on the first turn only', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-post-compact-attachments-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-post-compact-attachments',
      env,
    })
    const board = await ensureTaskBoardPlanFile(
      await getOrCreateTaskBoardForSession(session.sessionId, '/tmp/project', env),
      env,
    )
    await writeFile(
      board.planFilePath!,
      '# Plan\n\n- Preserve the current migration sequence.\n',
      'utf8',
    )

    const client = new CapturingLlmClient()
    const toolContext = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
    })
    toolContext.readState.set('/tmp/project/src/main.ts', {
      content: 'export const restored = true\n',
      timestamp: 100,
      isPartialView: false,
    })

    const engine = new QueryEngine({
      client,
      model: 'stub-model',
      modelLimitsEnv: env,
      toolRegistry: new ToolRegistry(),
      toolContext,
    })

    const { boundary, summaryMessage } = createCompactSummaryMessage({
      boundary: {
        boundaryId: 'compact_runtime_restore',
        createdAt: new Date().toISOString(),
        trigger: 'manual',
        messageCountBefore: 12,
        reason: 'user requested /compact',
      },
      summaryText: 'generated compact summary',
    })
    const boundaryMessage = createCompactBoundaryMessage(boundary)

    engine.preparePostCompactRecovery(boundary.boundaryId)
    engine.resetMessages([
      boundaryMessage,
      summaryMessage,
    ])

    await engine.submitUserPrompt('continue after compact')
    await engine.submitUserPrompt('continue again')

    const firstRequestText = client.requests[0]?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''
    const secondRequestText = client.requests[1]?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''

    assert.match(firstRequestText, /# Post-Compact Read File/)
    assert.match(firstRequestText, /path: \/tmp\/project\/src\/main\.ts/)
    assert.match(firstRequestText, /export const restored = true/)
    assert.match(firstRequestText, /# Post-Compact Plan File/)
    assert.match(firstRequestText, /Preserve the current migration sequence/)

    assert.doesNotMatch(secondRequestText, /# Post-Compact Read File/)
    assert.doesNotMatch(secondRequestText, /# Post-Compact Plan File/)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine forces a task reminder on the first post-compact turn when tasks exist', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-post-compact-task-reminder-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-post-compact-task-reminder',
      env,
    })
    const board = await getOrCreateTaskBoardForSession(
      session.sessionId,
      '/tmp/project',
      env,
    )
    await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        tasks: [
          {
            id: '1',
            subject: 'Review auth flow',
            description: 'Review auth flow before implementation',
            activeForm: 'Reviewing auth flow',
            status: 'in_progress',
            blocks: [],
            blockedBy: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        currentTaskId: '1',
        currentStep: 'Reviewing auth flow',
        updatedAt: new Date().toISOString(),
      }),
      env,
    )

    const client = new CapturingLlmClient()
    const engine = new QueryEngine({
      client,
      model: 'stub-model',
      modelLimitsEnv: env,
      toolRegistry: new ToolRegistry(),
      toolContext: createToolContext({
        cwd: '/tmp/project',
        sessionId: session.sessionId,
        availableTools: ['TaskCreate', 'TaskList', 'TaskUpdate'],
      }),
    })

    const { boundary, summaryMessage } = createCompactSummaryMessage({
      boundary: {
        boundaryId: 'compact_task_restore',
        createdAt: new Date().toISOString(),
        trigger: 'manual',
        messageCountBefore: 8,
        reason: 'user requested /compact',
      },
      summaryText: 'generated compact summary',
    })
    const boundaryMessage = createCompactBoundaryMessage(boundary)
    engine.preparePostCompactRecovery(boundary.boundaryId)
    engine.resetMessages([boundaryMessage, summaryMessage])

    await engine.submitUserPrompt('continue after compact')

    const requestText = client.requests[0]?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''

    assert.match(requestText, /# Task Tool Reminder/)
    assert.match(requestText, /Current task: #1 \[in_progress\] Review auth flow/)
    assert.match(requestText, /Current step: Reviewing auth flow/)
    assert.match(requestText, /Current task list:/)
    assert.match(requestText, /#1 \[in_progress\] Review auth flow/)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})


test('session meta records persisted tool result replacements', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-meta-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      env,
    })

    await appendSessionMessages(
      session.sessionId,
      [
        createMessage('user', [
          {
            type: 'tool_result',
            toolUseId: 'tool_big',
            output: {
              type: 'persisted_tool_result',
              toolName: 'Huge',
              summary: 'Huge output persisted',
              filepath: '/tmp/dclaw/tool-results/huge.txt',
              originalSizeChars: 123456,
              preview: 'preview',
              truncated: true,
            },
            rawOutput: {
              ok: true,
              summary: 'Ran Huge',
            },
          },
        ]),
      ],
      env,
    )

    const meta = await loadSessionMeta(session.sessionId, env)
    assert.ok(meta)
    assert.equal(meta.persistedToolResults.length, 1)
    assert.deepEqual(meta.persistedToolResults[0], {
      toolUseId: 'tool_big',
      toolName: 'Huge',
      filepath: '/tmp/dclaw/tool-results/huge.txt',
      originalSizeChars: 123456,
      recordedAt: meta.persistedToolResults[0]?.recordedAt,
    })
    assert.ok(meta.persistedToolResults[0]?.recordedAt)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
