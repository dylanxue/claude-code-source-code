import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { compactSession } from '../../src/compact/compactSession.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { getPlanBoardPath } from '../../src/session/paths.js'
import {
  ensurePlanFileForPlanBoard,
  getDefaultPlanFilePath,
  readPlanFile,
} from '../../src/tasks/planFiles.js'
import {
  attachPlanBoardToSession,
  createPlanBoard,
  getOrCreatePlanBoardForSession,
  loadPlanBoard,
  loadPlanBoardForSession,
} from '../../src/tasks/store.js'
import { createSession, loadSessionMeta } from '../../src/session/store.js'
import { createTextMessage } from '../../src/types/message.js'

test('plan board store persists and can be linked to a session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      planBoardId: 'board-test',
      env,
    })

    const board = await createPlanBoard({
      boardId: 'board-test',
      workspaceId: '/tmp/project',
      rootSessionId: session.sessionId,
      env,
    })

    const storedMeta = await loadSessionMeta(session.sessionId, env)
    const loadedBoard = await loadPlanBoard(board.boardId, env)
    const linkedBoard = await loadPlanBoardForSession(session.sessionId, env)

    assert.equal(storedMeta?.planBoardId, 'board-test')
    assert.ok(loadedBoard)
    assert.equal(loadedBoard.workspaceId, '/tmp/project')
    assert.equal(loadedBoard.latestSessionId, session.sessionId)
    assert.equal(loadedBoard.planFilePath, undefined)
    assert.equal(linkedBoard?.boardId, 'board-test')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('ensurePlanFileForPlanBoard creates a reusable plan scaffold', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-plan-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const board = await createPlanBoard({
      boardId: 'board-plan',
      workspaceId: '/tmp/project',
      rootSessionId: 'session-plan',
      env,
    })

    const result = await ensurePlanFileForPlanBoard(board, env)
    const content = await readPlanFile(result.filePath)

    assert.equal(result.created, true)
    assert.equal(result.filePath, getDefaultPlanFilePath(board.boardId, env))
    assert.equal(result.filePath.endsWith(`plan_${board.boardId}.md`), true)
    assert.ok(content)
    assert.match(content, /# Plan Board Plan/)
    assert.match(content, /## Purpose/)
    assert.match(content, /## Verification/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('createPlanBoard persists plan board brief metadata', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-brief-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const board = await createPlanBoard({
      boardId: 'board-brief',
      workspaceId: '/tmp/project',
      rootSessionId: 'session-brief-board',
      brief: {
        title: 'Project skeleton batch',
        purpose: 'Prepare the repository for implementation.',
        plan: 'Create directories, dependency files, and starter modules.',
      },
      env,
    })

    assert.equal(board.title, 'Project skeleton batch')
    assert.equal(board.purpose, 'Prepare the repository for implementation.')
    assert.equal(
      board.plan,
      'Create directories, dependency files, and starter modules.',
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('loadPlanBoard clears stale planFilePath for inactive boards when the file is missing', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-stale-plan-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const boardId = 'board-stale-plan'
    const boardPath = getPlanBoardPath(boardId, env)
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

    const board = await loadPlanBoard(boardId, env)
    const rewritten = await readFile(boardPath, 'utf8')

    assert.ok(board)
    assert.equal(board?.planFilePath, undefined)
    assert.doesNotMatch(rewritten, /planFilePath/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession keeps the plan board attached to the current session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-compact-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const source = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      planBoardId: 'board-compact',
      env,
    })
    await createPlanBoard({
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
      client: new StubLlmClient(),
      env,
    })

    const targetMeta = await loadSessionMeta(result.session.sessionId, env)
    const updatedBoard = await loadPlanBoard('board-compact', env)

    assert.equal(targetMeta?.planBoardId, 'board-compact')
    assert.equal(updatedBoard?.latestSessionId, source.sessionId)
    assert.equal(updatedBoard?.rootSessionId, source.sessionId)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('loadPlanBoard rewrites legacy boards that still contain todos', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-migrate-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const boardId = 'board-legacy'
    const boardPath = getPlanBoardPath(boardId, env)
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

    const board = await loadPlanBoard(boardId, env)
    const rewritten = await readFile(boardPath, 'utf8')

    assert.ok(board)
    assert.equal(board?.boardId, boardId)
    assert.equal('todos' in board!, false)
    assert.doesNotMatch(rewritten, /"todos"/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('loadPlanBoardForSession retires inactive completed plan boards after 5 seconds', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-retire-'))
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
    const created = await createPlanBoard({
      boardId: 'board-retire',
      workspaceId: '/tmp/project',
      rootSessionId: session.sessionId,
      latestSessionId: session.sessionId,
      env,
    })
    await attachPlanBoardToSession(session.sessionId, created.boardId, env)
    const retiredAt = new Date(Date.now() - 6_000).toISOString()
    await writeFile(
      getPlanBoardPath(created.boardId, env),
      JSON.stringify(
        {
          ...created,
          mode: 'inactive',
          updatedAt: retiredAt,
          tasks: [
            {
              id: '1',
              subject: 'Ship the current plan',
              description: 'Finish the current planning work.',
              status: 'completed',
              blocks: [],
              blockedBy: [],
              createdAt: retiredAt,
              updatedAt: retiredAt,
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )

    const board = await loadPlanBoardForSession(session.sessionId, env)
    const meta = await loadSessionMeta(session.sessionId, env)

    assert.equal(board, null)
    assert.equal(meta?.planBoardId, undefined)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('getOrCreatePlanBoardForSession creates a fresh board after the previous completed plan board retires', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-board-refresh-'))
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
    const first = await createPlanBoard({
      boardId: 'board-refresh-initial',
      workspaceId: '/tmp/project',
      rootSessionId: session.sessionId,
      latestSessionId: session.sessionId,
      env,
    })
    await attachPlanBoardToSession(session.sessionId, first.boardId, env)
    const retiredAt = new Date(Date.now() - 6_000).toISOString()
    await writeFile(
      getPlanBoardPath(first.boardId, env),
      JSON.stringify(
        {
          ...first,
          mode: 'inactive',
          updatedAt: retiredAt,
          tasks: [
            {
              id: '1',
              subject: 'Finish the current workstream',
              description: 'Close the existing plan board.',
              status: 'completed',
              blocks: [],
              blockedBy: [],
              createdAt: retiredAt,
              updatedAt: retiredAt,
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )

    const second = await getOrCreatePlanBoardForSession(
      session.sessionId,
      '/tmp/project',
      env,
    )
    const meta = await loadSessionMeta(session.sessionId, env)
    const retiredBoard = await loadPlanBoard(first.boardId, env)

    assert.notEqual(second.boardId, first.boardId)
    assert.equal(meta?.planBoardId, second.boardId)
    assert.ok(retiredBoard)
    assert.equal(retiredBoard?.boardId, first.boardId)
    assert.equal((retiredBoard as unknown as { tasks?: unknown[] }).tasks, undefined)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
