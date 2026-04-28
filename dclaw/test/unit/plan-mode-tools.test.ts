import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../../src/session/store.js'
import {
  ensurePlanBoardPlanFile,
  getOrCreatePlanBoardForSession,
  loadPlanBoardForSession,
  updatePlanBoard,
} from '../../src/tasks/store.js'
import { loadExecutionTaskBoardForSession } from '../../src/taskboard/store.js'
import { enterPlanModeTool } from '../../src/tools/builtin/enterPlanMode.js'
import { exitPlanModeTool } from '../../src/tools/builtin/exitPlanMode.js'
import { createToolContext } from '../helpers/toolContext.js'

test('EnterPlanMode activates planning state without asking for approval', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-enter-plan-tool-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-enter-plan',
      env,
    })

    let askUserQuestionsCalled = false
    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'accept-edits',
      askUserQuestions: async () => {
        askUserQuestionsCalled = true
        return { decision: 'Approve' }
      },
    })

    const result = await enterPlanModeTool.call(
      {
        note: 'Need to inspect the codebase before implementation.',
      },
      context,
    )

    assert.equal(result.output.status, 'entered')
    assert.equal(askUserQuestionsCalled, false)
    assert.equal(context.permissionMode, 'plan')
    assert.ok(context.planFilePath)
    assert.equal(existsSync(context.planFilePath), true)

    const board = await loadPlanBoardForSession(session.sessionId, env)
    assert.ok(board)
    assert.equal(board.mode, 'active')
    assert.equal(board.resumePermissionMode, 'accept-edits')
    assert.equal(board.planFilePath, context.planFilePath)
    assert.match(
      result.summary ?? '',
      /Planning lock entered\./,
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('ExitPlanMode exits planning without asking for approval', async () => {
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
    const board = await ensurePlanBoardPlanFile(
      await getOrCreatePlanBoardForSession(session.sessionId, '/tmp/project', env),
      env,
    )
    await updatePlanBoard(
      board.boardId,
      current => ({
        ...current,
        mode: 'active',
        resumePermissionMode: 'accept-edits',
        updatedAt: new Date().toISOString(),
      }),
      env,
    )
    await writeFile(
      board.planFilePath!,
      ['# Implementation Plan', '', '- Update the plan handoff flow'].join('\n'),
      'utf8',
    )

    let askUserQuestionsCalled = false
    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'plan',
      planFilePath: board.planFilePath,
      askUserQuestions: async () => {
        askUserQuestionsCalled = true
        return { decision: 'Approve' }
      },
    })

    const result = await exitPlanModeTool.call(
      {
        note: 'The plan file is ready for implementation.',
      },
      context,
    )

    assert.equal(result.output.status, 'exited')
    assert.equal(askUserQuestionsCalled, false)
    assert.equal(context.permissionMode, 'accept-edits')
    assert.equal(context.planFilePath, undefined)
    assert.match(
      result.output.message ?? '',
      /If this direction looks good, I can start implementation/,
    )
    assert.match(result.output.message ?? '', /- Update the plan handoff flow/)
    assert.equal(result.output.plan, '# Implementation Plan\n\n- Update the plan handoff flow')

    const updatedBoard = await loadPlanBoardForSession(session.sessionId, env)
    assert.ok(updatedBoard)
    assert.equal(updatedBoard.mode, 'inactive')
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('ExitPlanMode presents the plan and restores the previous permission mode', async () => {
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
    const board = await ensurePlanBoardPlanFile(
      await getOrCreatePlanBoardForSession(session.sessionId, '/tmp/project', env),
      env,
    )
    await updatePlanBoard(
      board.boardId,
      current => ({
        ...current,
        mode: 'active',
        resumePermissionMode: 'accept-edits',
        updatedAt: new Date().toISOString(),
      }),
      env,
    )
    await writeFile(
      board.planFilePath!,
      [
        '# Implementation Plan',
        '',
        '## Implementation Steps',
        '1. Inspect the current plan handoff flow',
        '2. Show the full plan body before waiting for user direction',
      ].join('\n'),
      'utf8',
    )

    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'plan',
      planFilePath: board.planFilePath,
    })

    const result = await exitPlanModeTool.call(
      {
        note: 'The plan file is ready for implementation.',
      },
      context,
    )

    assert.equal(result.output.status, 'exited')
    assert.equal(
      result.output.planPreview,
      '1. Inspect the current plan handoff flow',
    )
    assert.equal(context.permissionMode, 'accept-edits')
    assert.equal(context.planFilePath, undefined)

    const updatedBoard = await loadPlanBoardForSession(session.sessionId, env)
    assert.ok(updatedBoard)
    assert.equal(updatedBoard.mode, 'inactive')
    assert.equal(updatedBoard.resumePermissionMode, undefined)
    const executionBoard = await loadExecutionTaskBoardForSession(
      session.sessionId,
      env,
    )
    assert.equal(executionBoard, null)
    assert.match(
      result.summary ?? '',
      /Present the plan to the user and wait for the next instruction/,
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
