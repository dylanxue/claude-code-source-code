import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSession,
  ensureSessionPlanFile,
  getSessionPlanMode,
  updateSessionPlanMode,
} from '../../src/session/store.js'
import { loadExecutionTaskBoardForSession } from '../../src/taskboard/store.js'
import { exitPlanModeTool } from '../../src/tools/builtin/exitPlanMode.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createToolContext } from '../helpers/toolContext.js'

test('default tool registry does not expose EnterPlanMode to the model', () => {
  const registry = createDefaultToolRegistry()
  const toolNames = registry.list().map(tool => tool.name)

  assert.equal(toolNames.includes('EnterPlanMode'), false)
  assert.equal(toolNames.includes('ExitPlanMode'), true)
})

test('ExitPlanMode requests confirmation without leaving plan mode', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-exit-plan-no-approval-tool-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-exit-plan-reject',
      env,
    })
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await updateSessionPlanMode(
      session.sessionId,
      planMode => ({
        ...(planMode ?? { status: 'inactive' as const }),
        status: 'active',
        resumePermissionMode: 'accept-edits',
      }),
      env,
    )
    await writeFile(
      filePath,
      ['# Implementation Plan', '', '- Update the plan handoff flow'].join('\n'),
      'utf8',
    )

    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'plan',
      planFilePath: filePath,
    })

    const result = await exitPlanModeTool.call(
      {
        note: 'The plan file is ready for implementation.',
      },
      context,
    )

    assert.equal(result.output.status, 'confirmation_requested')
    assert.equal(context.permissionMode, 'plan')
    assert.equal(context.planFilePath, filePath)
    assert.match(
      result.output.message ?? '',
      /accept and implement it, accept it in a fresh context, or keep planning/,
    )
    assert.match(result.output.message ?? '', /- Update the plan handoff flow/)
    assert.equal(result.output.plan, '# Implementation Plan\n\n- Update the plan handoff flow')
    assert.deepEqual(result.output.confirmationOptions, [
      'Accept and implement',
      'Accept, clear context and implement',
      'Keep planning',
    ])

    const updatedPlanMode = await getSessionPlanMode(session.sessionId, env)
    assert.equal(updatedPlanMode?.status, 'active')
    assert.equal(updatedPlanMode?.needsExitReminder, false)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('ExitPlanMode exits only after the user accepts the plan', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-exit-plan-tool-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-exit-plan',
      env,
    })
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await updateSessionPlanMode(
      session.sessionId,
      planMode => ({
        ...(planMode ?? { status: 'inactive' as const }),
        status: 'active',
        resumePermissionMode: 'accept-edits',
      }),
      env,
    )
    await writeFile(
      filePath,
      [
        '# Implementation Plan',
        '',
        '## Implementation Steps',
        '1. Inspect the current plan handoff flow',
        '2. Show the full plan body before waiting for user direction',
      ].join('\n'),
      'utf8',
    )

    let askedQuestions: Parameters<NonNullable<ReturnType<typeof createToolContext>['askUserQuestions']>>[0] | undefined
    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'plan',
      planFilePath: filePath,
      askUserQuestions: async questions => {
        askedQuestions = questions
        return {
        exit_plan_mode_decision: 'Accept and implement',
        }
      },
    })

    const result = await exitPlanModeTool.call(
      {
        note: 'The plan file is ready for implementation.',
      },
      context,
    )

    assert.equal(result.output.status, 'accepted_implement')
    assert.equal(askedQuestions?.[0]?.header, 'Plan Ready')
    assert.match(askedQuestions?.[0]?.preview ?? '', /# Implementation Plan/)
    assert.ok(
      askedQuestions?.[0]?.options.every(option => option.preview === undefined),
    )
    assert.equal(
      result.output.planPreview,
      '1. Inspect the current plan handoff flow',
    )
    assert.equal(context.permissionMode, 'accept-edits')
    assert.equal(context.planFilePath, undefined)
    assert.equal(result.output.resumedPermissionMode, 'accept-edits')
    assert.equal(result.newMessages?.length, 1)
    assert.match(
      result.newMessages?.[0]?.content[0]?.type === 'text'
        ? result.newMessages[0].content[0].text
        : '',
      /User has approved the plan/,
    )

    const updatedPlanMode = await getSessionPlanMode(session.sessionId, env)
    assert.equal(updatedPlanMode?.status, 'inactive')
    assert.equal(updatedPlanMode?.resumePermissionMode, undefined)
    assert.equal(updatedPlanMode?.needsExitReminder, true)
    const executionBoard = await loadExecutionTaskBoardForSession(
      session.sessionId,
      env,
    )
    assert.equal(executionBoard, null)
    assert.match(
      result.summary ?? '',
      /Plan approved/,
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
