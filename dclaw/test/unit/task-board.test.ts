import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { compactSession } from '../../src/compact/compactSession.js'
import { getTaskBoardPath } from '../../src/session/paths.js'
import {
  ensurePlanFileForTaskBoard,
  getDefaultPlanFilePath,
  readPlanFile,
} from '../../src/tasks/planFiles.js'
import {
  createSessionTask,
  createTaskBoard,
  loadTaskBoard,
  loadTaskBoardForSession,
  updateTaskBoard,
} from '../../src/tasks/store.js'
import { createSession, loadSessionMeta } from '../../src/session/store.js'
import { createTextMessage } from '../../src/types/message.js'

test('task board store persists and can be linked to a session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      taskBoardId: 'board-test',
      env,
    })

    const board = await createTaskBoard({
      boardId: 'board-test',
      workspaceId: '/tmp/project',
      rootSessionId: session.sessionId,
      env,
    })

    const storedMeta = await loadSessionMeta(session.sessionId, env)
    const loadedBoard = await loadTaskBoard(board.boardId, env)
    const linkedBoard = await loadTaskBoardForSession(session.sessionId, env)

    assert.equal(storedMeta?.taskBoardId, 'board-test')
    assert.ok(loadedBoard)
    assert.equal(loadedBoard.workspaceId, '/tmp/project')
    assert.equal(loadedBoard.latestSessionId, session.sessionId)
    assert.equal(loadedBoard.planFilePath, undefined)
    assert.equal(linkedBoard?.boardId, 'board-test')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('ensurePlanFileForTaskBoard creates a reusable plan scaffold', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-plan-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const board = await createTaskBoard({
      boardId: 'board-plan',
      workspaceId: '/tmp/project',
      rootSessionId: 'session-plan',
      env,
    })

    const result = await ensurePlanFileForTaskBoard(board, env)
    const content = await readPlanFile(result.filePath)

    assert.equal(result.created, true)
    assert.equal(result.filePath, getDefaultPlanFilePath(board.boardId, env))
    assert.equal(result.filePath.endsWith(`plan_${board.boardId}.md`), true)
    assert.ok(content)
    assert.match(content, /# Task Board Plan/)
    assert.match(content, /## Purpose/)
    assert.match(content, /## Verification/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('createSessionTask initializes a short-lived task board brief', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-brief-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-brief-board',
      env,
    })

    const created = await createSessionTask(
      session.sessionId,
      '/tmp/project',
      {
        subject: 'Initialize project skeleton',
        description: 'Create the current implementation batch scaffolding.',
        board: {
          title: 'Project skeleton batch',
          purpose: 'Prepare the repository for implementation.',
          plan: 'Create directories, dependency files, and starter modules.',
        },
      },
      env,
    )

    assert.equal(created.board.title, 'Project skeleton batch')
    assert.equal(created.board.purpose, 'Prepare the repository for implementation.')
    assert.equal(
      created.board.plan,
      'Create directories, dependency files, and starter modules.',
    )
    assert.equal(created.board.tasks.length, 1)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('loadTaskBoard clears stale planFilePath for inactive boards when the file is missing', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-stale-plan-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const boardId = 'board-stale-plan'
    const boardPath = getTaskBoardPath(boardId, env)
    const now = new Date().toISOString()
    await mkdir(join(homeDir, '.dclaw', 'task-boards'), { recursive: true })

    await writeFile(
      boardPath,
      JSON.stringify(
        {
          boardId,
          workspaceId: '/tmp/project',
          rootSessionId: 'session-stale-plan',
          latestSessionId: 'session-stale-plan',
          planFilePath: join(
            homeDir,
            '.dclaw',
            'plans',
            'plan_board-stale-plan.md',
          ),
          mode: 'inactive',
          createdAt: now,
          updatedAt: now,
          tasks: [],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )

    const board = await loadTaskBoard(boardId, env)
    const rewritten = await readFile(boardPath, 'utf8')

    assert.ok(board)
    assert.equal(board?.planFilePath, undefined)
    assert.doesNotMatch(rewritten, /planFilePath/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession keeps the task board attached to the current session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-compact-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const source = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      taskBoardId: 'board-compact',
      env,
    })
    await createTaskBoard({
      boardId: 'board-compact',
      workspaceId: '/tmp/project',
      rootSessionId: source.sessionId,
      env,
    })

    const messages = [
      createTextMessage('user', 'first'),
      createTextMessage('assistant', 'second'),
    ]

    const result = await compactSession({
      sourceSessionId: source.sessionId,
      messages,
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      reason: 'user requested /compact',
      env,
    })

    const targetMeta = await loadSessionMeta(result.session.sessionId, env)
    const updatedBoard = await loadTaskBoard('board-compact', env)

    assert.equal(targetMeta?.taskBoardId, 'board-compact')
    assert.equal(updatedBoard?.latestSessionId, source.sessionId)
    assert.equal(updatedBoard?.rootSessionId, source.sessionId)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('loadTaskBoard rewrites legacy boards that still contain todos', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-migrate-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const boardId = 'board-legacy'
    const boardPath = getTaskBoardPath(boardId, env)
    const now = new Date().toISOString()
    await mkdir(join(homeDir, '.dclaw', 'task-boards'), { recursive: true })

    await writeFile(
      boardPath,
      JSON.stringify(
        {
          boardId,
          workspaceId: '/tmp/project',
          rootSessionId: 'session-legacy',
          latestSessionId: 'session-legacy',
          planFilePath: '/tmp/project/.dclaw/plans/plan_board-legacy.md',
          mode: 'inactive',
          createdAt: now,
          updatedAt: now,
          tasks: [],
          todos: [
            {
              id: 'todo_1',
              content: 'legacy todo',
              status: 'pending',
              priority: 'medium',
              order: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )

    const board = await loadTaskBoard(boardId, env)
    const rewritten = await readFile(boardPath, 'utf8')

    assert.ok(board)
    assert.equal(board?.boardId, boardId)
    assert.equal('todos' in board!, false)
    assert.doesNotMatch(rewritten, /"todos"/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('loadTaskBoardForSession retires inactive completed task boards after 5 seconds', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-retire-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-retire-board',
      env,
    })
    const created = await createSessionTask(
      session.sessionId,
      '/tmp/project',
      {
        subject: 'Ship the current plan',
        description: 'Finish the current implementation work.',
      },
      env,
    )
    const retiredAt = new Date(Date.now() - 6_000).toISOString()
    await updateTaskBoard(
      created.board.boardId,
      current => ({
        ...current,
        mode: 'inactive',
        updatedAt: retiredAt,
        currentTaskId: undefined,
        currentStep: undefined,
        tasks: current.tasks.map(task => ({
          ...task,
          status: 'completed',
          updatedAt: retiredAt,
        })),
      }),
      env,
    )

    const board = await loadTaskBoardForSession(session.sessionId, env)
    const meta = await loadSessionMeta(session.sessionId, env)

    assert.equal(board, null)
    assert.equal(meta?.taskBoardId, undefined)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('createSessionTask creates a fresh board after the previous completed board retires', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-board-refresh-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-refresh-board',
      env,
    })
    const first = await createSessionTask(
      session.sessionId,
      '/tmp/project',
      {
        subject: 'Finish the current workstream',
        description: 'Close the existing task list.',
      },
      env,
    )
    const retiredAt = new Date(Date.now() - 6_000).toISOString()
    await updateTaskBoard(
      first.board.boardId,
      current => ({
        ...current,
        mode: 'inactive',
        updatedAt: retiredAt,
        currentTaskId: undefined,
        currentStep: undefined,
        tasks: current.tasks.map(task => ({
          ...task,
          status: 'completed',
          updatedAt: retiredAt,
        })),
      }),
      env,
    )

    const second = await createSessionTask(
      session.sessionId,
      '/tmp/project',
      {
        subject: 'Start a new top-level request',
        description: 'Handle the next user request without appending to the old board.',
      },
      env,
    )
    const meta = await loadSessionMeta(session.sessionId, env)
    const retiredBoard = await loadTaskBoard(first.board.boardId, env)

    assert.notEqual(second.board.boardId, first.board.boardId)
    assert.equal(second.task.id, '1')
    assert.equal(meta?.taskBoardId, second.board.boardId)
    assert.ok(retiredBoard)
    assert.equal(retiredBoard?.tasks.length, 1)
    assert.equal(retiredBoard?.tasks[0]?.status, 'completed')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
