import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import type { CompactBoundary } from '../../src/compact/types.js'
import { createCompactBoundaryMessage } from '../../src/compact/boundaryMessage.js'
import {
  createMessage,
  createTextMessage,
  getTextContent,
  type Message,
} from '../../src/types/message.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { buildTool } from '../../src/tools/types.js'
import {
  createSession,
  ensureSessionPlanFile,
  getSessionPlanMode,
  updateSessionPlanMode,
} from '../../src/session/store.js'
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
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'active',
        planFilePath: filePath,
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
        planFilePath: filePath,
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
      /same language as the user's latest planning request/,
    )
    assert.match(
      getTextContent(reminders[0]!),
      new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
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
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'inactive',
        hasExitedInSession: true,
        needsExitReminder: true,
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

    const firstResult = await engine.submitUserPrompt('start implementation')
    const firstReminders = findReminderMessages(client.requests[0])
    assert.equal(firstReminders.length, 1)
    assert.match(getTextContent(firstReminders[0]!), /## Exited Plan Mode/)
    assert.equal(
      firstResult.appendedMessages.some(message =>
        getTextContent(message).includes('## Exited Plan Mode'),
      ),
      false,
    )
    assert.equal(
      engine.getMessages().some(message =>
        getTextContent(message).includes('## Exited Plan Mode'),
      ),
      false,
    )

    const planModeAfterFirstTurn = await getSessionPlanMode(session.sessionId, env)
    assert.ok(planModeAfterFirstTurn)
    assert.equal(planModeAfterFirstTurn?.needsExitReminder, false)

    await engine.submitUserPrompt('continue implementation')
    const secondReminders = findReminderMessages(client.requests[1])
    assert.equal(secondReminders.length, 0)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine refreshes planning prompt state after exiting plan mode mid-turn', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-exit-mid-turn-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-plan-exit-mid-turn',
      env,
    })
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'active',
        planFilePath: filePath,
      }),
      env,
    )

    const client = new (class implements LlmClient {
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
                id: 'tool_exit_plan',
                name: 'ExitPlanModeStub',
                input: {},
              },
            ]),
          }
        }

        return {
          message: createTextMessage('assistant', 'the plan is ready for review'),
        }
      }
    })()
    const registry = new ToolRegistry()
    registry.register(
      buildTool({
        name: 'ExitPlanModeStub',
        description: 'Exit plan mode in the current session.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
          required: ['status'],
          additionalProperties: false,
        },
        isReadOnly() {
          return true
        },
        async call(_input, context) {
          context.setPermissionMode?.('default')
          context.setPlanFilePath?.(undefined)
          await updateSessionPlanMode(
            session.sessionId,
            current => ({
              ...(current ?? { status: 'active' as const }),
              status: 'inactive',
              hasExitedInSession: true,
              needsExitReminder: true,
            }),
            env,
          )

          return {
            ok: true,
            output: { status: 'exited' },
          }
        },
      }),
    )

    const engine = new QueryEngine({
      client,
      model: 'stub-model',
      modelLimitsEnv: env,
      systemPromptResolver: async state => `permission mode: ${state.permissionMode}`,
      toolRegistry: registry,
      toolContext: createToolContext({
        cwd: '/tmp/project',
        sessionId: session.sessionId,
        permissionMode: 'plan',
        planFilePath: filePath,
        availableTools: registry.list().map(tool => tool.name),
      }),
    })

    const result = await engine.submitUserPrompt('finish the plan and continue')

    assert.equal(result.outputText, 'the plan is ready for review')
    assert.equal(client.requests.length, 2)
    assert.equal(client.requests[0]?.systemPrompt, 'permission mode: plan')
    assert.equal(client.requests[1]?.systemPrompt, 'permission mode: default')

    const firstReminderText = findReminderMessages(client.requests[0])
      .map(message => getTextContent(message))
      .join('\n')
    const secondReminderText = findReminderMessages(client.requests[1])
      .map(message => getTextContent(message))
      .join('\n')

    assert.match(firstReminderText, /## Plan Mode/)
    assert.doesNotMatch(secondReminderText, /## Plan Mode/)
    assert.match(secondReminderText, /## Exited Plan Mode/)
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
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'active',
        planFilePath: filePath,
        hasExitedInSession: true,
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
        planFilePath: filePath,
        availableTools: registry.list().map(tool => tool.name),
      }),
    })

    const firstResult = await engine.submitUserPrompt('refine the plan')
    const reminders = findReminderMessages(client.requests[0])
    assert.equal(reminders.length, 2)
    assert.match(getTextContent(reminders[0]!), /## Re-entering Plan Mode/)
    assert.match(getTextContent(reminders[1]!), /## Plan Mode/)
    assert.equal(
      firstResult.appendedMessages.some(message =>
        getTextContent(message).includes('## Re-entering Plan Mode'),
      ),
      false,
    )
    assert.equal(
      engine.getMessages().some(message =>
        getTextContent(message).includes('## Re-entering Plan Mode'),
      ),
      false,
    )

    const planModeAfterFirstTurn = await getSessionPlanMode(session.sessionId, env)
    assert.ok(planModeAfterFirstTurn)
    assert.equal(planModeAfterFirstTurn?.hasExitedInSession, false)

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
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await writeFile(
      filePath,
      '# Plan\n\n- Keep the active plan after compact.\n',
      'utf8',
    )
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'active',
        planFilePath: filePath,
        reminderCount: 3,
        lastReminderTurnCount: 99,
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
        planFilePath: filePath,
        availableTools: registry.list().map(tool => tool.name),
      }),
      initialMessages: [compactBoundaryMessage, compactSummary],
    })

    const result = await engine.submitUserPrompt('continue after compact')

    const reminders = findReminderMessages(client.requests[0])
    const reminderTexts = reminders.map(message => getTextContent(message))
    assert.equal(
      reminderTexts.filter(text => /## Plan Mode/.test(text)).length,
      1,
    )
    assert.ok(reminderTexts.some(text => /## Plan Mode/.test(text)))
    assert.ok(reminderTexts.some(text => /Do not start implementation yet/.test(text)))
    assert.ok(reminderTexts.every(text => !/# Post-Compact Task Board/.test(text)))
    assert.ok(reminderTexts.every(text => !/# Task Tool Reminder/.test(text)))
    const requestText = client.requests[0]?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''
    assert.match(requestText, /# Post-Compact Plan File/)
    assert.match(requestText, /Keep the active plan after compact/)
    assert.equal(
      result.appendedMessages.some(message =>
        getTextContent(message).includes('## Plan Mode'),
      ),
      false,
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
