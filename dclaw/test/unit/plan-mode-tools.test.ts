import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../../src/session/store.js'
import {
  ensureTaskBoardPlanFile,
  getOrCreateTaskBoardForSession,
  listSessionTasks,
  loadTaskBoardForSession,
  updateTaskBoard,
} from '../../src/tasks/store.js'
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

    assert.equal(result.output.status, 'approved')
    assert.equal(askUserQuestionsCalled, false)
    assert.equal(context.permissionMode, 'plan')
    assert.ok(context.planFilePath)
    assert.equal(existsSync(context.planFilePath), true)

    const board = await loadTaskBoardForSession(session.sessionId, env)
    assert.ok(board)
    assert.equal(board.mode, 'active')
    assert.equal(board.resumePermissionMode, 'accept-edits')
    assert.equal(board.planFilePath, context.planFilePath)
    assert.match(
      result.summary ?? '',
      /Plan mode entered\./,
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('ExitPlanMode returns Claude Code style rejection feedback when the user keeps planning', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-exit-plan-reject-tool-'))
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
    const board = await ensureTaskBoardPlanFile(
      await getOrCreateTaskBoardForSession(session.sessionId, '/tmp/project', env),
      env,
    )
    await updateTaskBoard(
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
      ['# Implementation Plan', '', '- Update the approval flow'].join('\n'),
      'utf8',
    )

    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'plan',
      planFilePath: board.planFilePath,
      askUserQuestions: async () => ({ decision: 'Keep Planning' }),
    })

    const result = await exitPlanModeTool.call(
      {
        note: 'The plan file is ready for implementation.',
      },
      context,
    )

    assert.equal(result.output.status, 'rejected')
    assert.equal(context.permissionMode, 'plan')
    assert.equal(context.planFilePath, board.planFilePath)
    assert.match(
      result.output.message ?? '',
      /The agent proposed a plan that was rejected by the user\./,
    )
    assert.match(result.output.message ?? '', /Rejected plan:/)
    assert.match(result.output.message ?? '', /- Update the approval flow/)
    assert.equal(result.output.plan, '# Implementation Plan\n\n- Update the approval flow')

    const updatedBoard = await loadTaskBoardForSession(session.sessionId, env)
    assert.ok(updatedBoard)
    assert.equal(updatedBoard.mode, 'active')
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('ExitPlanMode requests approval and restores the previous permission mode', async () => {
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
    const board = await ensureTaskBoardPlanFile(
      await getOrCreateTaskBoardForSession(session.sessionId, '/tmp/project', env),
      env,
    )
    await updateTaskBoard(
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
        '1. Inspect the current approval flow',
        '2. Show the full plan body before approval',
      ].join('\n'),
      'utf8',
    )

    let capturedPreview: string | undefined

    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'plan',
      planFilePath: board.planFilePath,
      askUserQuestions: async (questions, options) => {
        assert.equal(options?.allowPreviewActions, undefined)
        capturedPreview = questions[0]?.options[0]?.preview
        return { decision: 'Approve' }
      },
    })

    const result = await exitPlanModeTool.call(
      {
        note: 'The plan file is ready for implementation.',
      },
      context,
    )

    assert.equal(result.output.status, 'approved')
    assert.equal(
      capturedPreview,
      [
        '# Implementation Plan',
        '',
        '## Implementation Steps',
        '1. Inspect the current approval flow',
        '2. Show the full plan body before approval',
      ].join('\n'),
    )
    assert.equal(
      result.output.planPreview,
      '1. Inspect the current approval flow',
    )
    assert.equal(context.permissionMode, 'accept-edits')
    assert.equal(context.planFilePath, undefined)

    const updatedBoard = await loadTaskBoardForSession(session.sessionId, env)
    assert.ok(updatedBoard)
    assert.equal(updatedBoard.mode, 'inactive')
    assert.equal(updatedBoard.resumePermissionMode, undefined)
    const listed = await listSessionTasks(session.sessionId, env)
    assert.deepEqual(
      listed.tasks.map(task => ({
        id: task.id,
        subject: task.subject,
        description: task.description,
      })),
      [
        {
          id: '1',
          subject: 'Inspect the current approval flow',
          description: 'Inspect the current approval flow',
        },
        {
          id: '2',
          subject: 'Show the full plan body before approval',
          description: 'Show the full plan body before approval',
        },
      ],
    )
    assert.match(
      result.summary ?? '',
      /Created 2 initial task\(s\) from the approved plan/,
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
