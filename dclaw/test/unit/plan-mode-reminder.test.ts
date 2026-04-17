import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import type { CompactBoundary } from '../../src/compact/types.js'
import { createCompactBoundaryMessage } from '../../src/compact/boundaryMessage.js'
import { createTextMessage, getTextContent, type Message } from '../../src/types/message.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createSession } from '../../src/session/store.js'
import {
  getOrCreateTaskBoardForSession,
  loadTaskBoardForSession,
  updateTaskBoard,
} from '../../src/tasks/store.js'
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

function findReminderMessages(request: CreateMessageRequest | undefined): Message[] {
  return (request?.messages ?? []).filter(message => {
    return (
      message.role === 'user' &&
      getTextContent(message).startsWith('<system-reminder>')
    )
  })
}

test('QueryEngine injects a plan_mode reminder as a temporary system-reminder message', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-mode-reminder-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-plan-mode-reminder',
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
        mode: 'active',
        updatedAt: new Date().toISOString(),
      }),
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
        permissionMode: 'plan',
        planFilePath: board.planFilePath,
        availableTools: registry.list().map(tool => tool.name),
      }),
    })

    await engine.submitUserPrompt('continue planning')

    const reminders = findReminderMessages(client.requests[0])
    assert.equal(reminders.length, 1)
    assert.match(getTextContent(reminders[0]!), /## Plan Mode/)
    assert.match(getTextContent(reminders[0]!), /Do not start implementation yet/)
    assert.match(
      getTextContent(reminders[0]!),
      new RegExp(board.planFilePath!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )

    assert.equal(
      engine.getMessages().some(message =>
        getTextContent(message).includes('## Plan Mode'),
      ),
      false,
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine injects a one-time plan_mode_exit reminder after leaving plan mode', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-exit-reminder-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-plan-exit-reminder',
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
        mode: 'inactive',
        hasExitedPlanModeInSession: true,
        needsPlanModeExitReminder: true,
        updatedAt: new Date().toISOString(),
      }),
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
        permissionMode: 'default',
        availableTools: registry.list().map(tool => tool.name),
      }),
    })

    await engine.submitUserPrompt('start implementation')
    const firstReminders = findReminderMessages(client.requests[0])
    assert.equal(firstReminders.length, 1)
    assert.match(getTextContent(firstReminders[0]!), /## Exited Plan Mode/)

    const boardAfterFirstTurn = await loadTaskBoardForSession(session.sessionId, env)
    assert.ok(boardAfterFirstTurn)
    assert.equal(boardAfterFirstTurn?.needsPlanModeExitReminder, false)

    await engine.submitUserPrompt('continue implementation')
    const secondReminders = findReminderMessages(client.requests[1])
    assert.equal(secondReminders.length, 0)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine injects a plan_mode_reentry reminder once when planning resumes after exit', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-reentry-reminder-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-plan-reentry-reminder',
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
        mode: 'active',
        hasExitedPlanModeInSession: true,
        updatedAt: new Date().toISOString(),
      }),
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
        permissionMode: 'plan',
        planFilePath: board.planFilePath,
        availableTools: registry.list().map(tool => tool.name),
      }),
    })

    await engine.submitUserPrompt('refine the plan')
    const reminders = findReminderMessages(client.requests[0])
    assert.equal(reminders.length, 2)
    assert.match(getTextContent(reminders[0]!), /## Re-entering Plan Mode/)
    assert.match(getTextContent(reminders[1]!), /## Plan Mode/)

    const boardAfterFirstTurn = await loadTaskBoardForSession(session.sessionId, env)
    assert.ok(boardAfterFirstTurn)
    assert.equal(boardAfterFirstTurn?.hasExitedPlanModeInSession, false)

    await engine.submitUserPrompt('keep refining')
    const secondTurnReminders = findReminderMessages(client.requests[1])
    assert.equal(secondTurnReminders.length, 0)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine forces a full plan_mode reminder on the first post-compact turn', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-post-compact-plan-reminder-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-post-compact-plan-reminder',
      env,
    })
    const compactSummary = createTextMessage(
      'assistant',
      'Compact summary from earlier in this session.',
    )
    const compactSource: CompactBoundary = {
      boundaryId: 'compact_test',
      createdAt: new Date().toISOString(),
      trigger: 'manual',
      messageCountBefore: 42,
      summaryMessageId: compactSummary.id,
    }
    const compactBoundaryMessage = createCompactBoundaryMessage(compactSource)
    const board = await getOrCreateTaskBoardForSession(
      session.sessionId,
      '/tmp/project',
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
        planModeReminderCount: 3,
        lastPlanModeReminderTurnCount: 99,
        updatedAt: new Date().toISOString(),
      }),
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
        permissionMode: 'plan',
        planFilePath: board.planFilePath,
        availableTools: registry.list().map(tool => tool.name),
      }),
      initialMessages: [compactBoundaryMessage, compactSummary],
    })

    await engine.submitUserPrompt('continue after compact')

    const reminders = findReminderMessages(client.requests[0])
    assert.equal(reminders.length, 2)
    const reminderTexts = reminders.map(message => getTextContent(message))
    assert.ok(reminderTexts.some(text => /## Plan Mode/.test(text)))
    assert.ok(reminderTexts.some(text => /Do not start implementation yet/.test(text)))
    assert.ok(reminderTexts.some(text => /Current task: Review auth flow/.test(text)))
    assert.ok(reminderTexts.some(text => /Current step: Reviewing auth flow/.test(text)))
    assert.ok(reminderTexts.some(text => /# Task Tool Reminder/.test(text)))
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
