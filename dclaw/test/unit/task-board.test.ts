import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { compactSession } from '../../src/compact/compactSession.js'
import { getTaskBoardPath } from '../../src/session/paths.js'
import { ensurePlanFileForTaskBoard, readPlanFile } from '../../src/tasks/planFiles.js'
import { createTaskBoard, loadTaskBoard, loadTaskBoardForSession } from '../../src/tasks/store.js'
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
    assert.equal(result.filePath, board.planFilePath)
    assert.ok(content)
    assert.match(content, /# Plan/)
    assert.match(content, /## Goal/)
    assert.match(content, /## Verification/)
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
