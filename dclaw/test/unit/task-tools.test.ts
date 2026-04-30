import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../../src/session/store.js'
import { getSessionExecutionTaskBoardPath } from '../../src/session/paths.js'
import { loadExecutionTaskBoardForSession } from '../../src/taskboard/store.js'
import { taskCreateTool } from '../../src/tools/builtin/taskCreate.js'
import { taskGetTool } from '../../src/tools/builtin/taskGet.js'
import { taskListTool } from '../../src/tools/builtin/taskList.js'
import { taskUpdateTool } from '../../src/tools/builtin/taskUpdate.js'
import { createToolContext } from '../helpers/toolContext.js'

test('TaskCreate can seed a new task board with multiple tasks', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-tools-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-tools',
      env,
    })
    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
      permissionMode: 'plan',
    })

    const created = await taskCreateTool.call(
      {
        board: {
          title: 'Task tools rollout',
          purpose: 'Track the initial implementation batch.',
        },
        tasks: [
          {
            subject: 'Define task schema',
            description: 'Add TaskCreate, TaskList, TaskGet, and TaskUpdate.',
          },
          {
            subject: 'Wire task tools',
            description: 'Expose the task tool surface in the runtime.',
          },
          {
            subject: 'Verify task flows',
            description: 'Exercise creation, listing, and updates end to end.',
          },
        ],
      },
      context,
    )

    assert.deepEqual(created.output, {
      tasks: [
        {
          id: '1',
          subject: 'Define task schema',
          status: 'in_progress',
        },
        {
          id: '2',
          subject: 'Wire task tools',
          status: 'pending',
        },
        {
          id: '3',
          subject: 'Verify task flows',
          status: 'pending',
        },
      ],
    })
    assert.equal(created.newMessages?.length, 1)
    assert.match(
      ((created.newMessages?.[0]?.content[0] as { type: 'text'; text: string })
        ?.text ?? ''),
      /Execution has already started/i,
    )
    assert.match(
      ((created.newMessages?.[0]?.content[0] as { type: 'text'; text: string })
        ?.text ?? ''),
      /first task is already in_progress/i,
    )
    assert.doesNotMatch(
      ((created.newMessages?.[0]?.content[0] as { type: 'text'; text: string })
        ?.text ?? ''),
      /If the user asked you to build/i,
    )
    assert.equal(context.activeExecutionTaskBoardIdThisTurn?.startsWith('taskboard_'), true)

    const listed = await taskListTool.call({}, context)
    assert.deepEqual(listed.output.tasks, [
      {
        id: '1',
        subject: 'Define task schema',
        status: 'in_progress',
        owner: undefined,
        blockedBy: [],
      },
      {
        id: '2',
        subject: 'Wire task tools',
        status: 'pending',
        owner: undefined,
        blockedBy: [],
      },
      {
        id: '3',
        subject: 'Verify task flows',
        status: 'pending',
        owner: undefined,
        blockedBy: [],
      },
    ])
    assert.match(listed.summary ?? '', /#1 \[in_progress\] Define task schema/)

    const fetched = await taskGetTool.call({ taskId: '1' }, context)
    assert.deepEqual(fetched.output.task, {
      id: '1',
      subject: 'Define task schema',
      description: 'Add TaskCreate, TaskList, TaskGet, and TaskUpdate.',
      status: 'in_progress',
      blocks: [],
      blockedBy: [],
    })
    assert.match(fetched.summary ?? '', /Task #1: Define task schema/)

    await access(getSessionExecutionTaskBoardPath(session.sessionId, '/tmp/project', env))
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('TaskCreate rejects fewer than 3 tasks', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-tools-single-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-tools-single',
      env,
    })
    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
    })

    const validation = await taskCreateTool.validate(
      {
        tasks: [
          {
            subject: 'Build the app shell',
            description: 'Create the project scaffold.',
          },
          {
            subject: 'Connect the engine',
            description: 'Wire the engine into the UI.',
          },
        ],
      },
      context,
    )

    assert.deepEqual(validation, {
      ok: false,
      error:
        'TaskCreate should only be used when starting an execution task list with at least 3 concrete tasks. If the work breaks into fewer than 3 tasks, skip task tracking.',
    })
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('TaskUpdate enforces a single active task and supports cancellation', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-update-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-update',
      env,
    })
    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
    })

    await taskCreateTool.call(
      {
        tasks: [
          {
            subject: 'Define task schema',
            description: 'Add subject, description, and dependency fields.',
          },
          {
            subject: 'Wire task tools',
            description: 'Expose TaskCreate, TaskList, TaskGet, and TaskUpdate.',
          },
          {
            subject: 'Verify task tools',
            description: 'Confirm the tool contract and workflow semantics.',
          },
        ],
      },
      context,
    )

    const updated = await taskUpdateTool.call(
      {
        taskId: '2',
        status: 'in_progress',
        owner: 'codex',
        metadata: {
          area: 'tasks',
        },
        addBlockedBy: ['1'],
      },
      context,
    )

    assert.deepEqual(updated.output, {
      success: false,
      taskId: '2',
      updatedFields: [],
      error:
        'Task #1 is already in_progress. Finish or cancel it before starting another task.',
    })
    assert.match(updated.summary ?? '', /already in_progress/i)

    const completedFirst = await taskUpdateTool.call(
      {
        taskId: '1',
        status: 'completed',
      },
      context,
    )
    assert.deepEqual(completedFirst.output, {
      success: true,
      taskId: '1',
      updatedFields: ['status'],
      statusChange: {
        from: 'in_progress',
        to: 'completed',
      },
    })

    const startedSecond = await taskUpdateTool.call(
      {
        taskId: '2',
        status: 'in_progress',
        owner: 'codex',
        metadata: {
          area: 'tasks',
        },
        addBlockedBy: ['1'],
      },
      context,
    )
    assert.deepEqual(startedSecond.output, {
      success: true,
      taskId: '2',
      updatedFields: ['owner', 'metadata', 'status', 'blockedBy'],
      statusChange: {
        from: 'pending',
        to: 'in_progress',
      },
    })
    assert.match(startedSecond.summary ?? '', /Task #2 marked in_progress/)

    const taskTwo = await taskGetTool.call({ taskId: '2' }, context)
    assert.deepEqual(taskTwo.output.task, {
      id: '2',
      subject: 'Wire task tools',
      description: 'Expose TaskCreate, TaskList, TaskGet, and TaskUpdate.',
      status: 'in_progress',
      blocks: [],
      blockedBy: ['1'],
    })

    const completed = await taskUpdateTool.call(
      {
        taskId: '2',
        status: 'completed',
      },
      context,
    )

    assert.deepEqual(completed.output, {
      success: true,
      taskId: '2',
      updatedFields: ['status'],
      statusChange: {
        from: 'in_progress',
        to: 'completed',
      },
    })
    assert.match(
      completed.summary ?? '',
      /Call TaskList now to find the next available task/i,
    )

    const taskOne = await taskGetTool.call({ taskId: '1' }, context)
    assert.deepEqual(taskOne.output.task, {
      id: '1',
      subject: 'Define task schema',
      description: 'Add subject, description, and dependency fields.',
      status: 'completed',
      blocks: ['2'],
      blockedBy: [],
    })

    const cancelled = await taskUpdateTool.call(
      {
        taskId: '3',
        status: 'cancelled',
      },
      context,
    )

    assert.deepEqual(cancelled.output, {
      success: true,
      taskId: '3',
      updatedFields: ['status'],
      statusChange: {
        from: 'pending',
        to: 'cancelled',
      },
    })

    const listed = await taskListTool.call({}, context)
    assert.deepEqual(listed.output.tasks, [])

    const board = await loadExecutionTaskBoardForSession(session.sessionId, env)
    assert.ok(board)
    assert.equal(board.currentTaskId, undefined)

    const nextBatch = await taskCreateTool.call(
      {
        tasks: [
          {
            subject: 'Start follow-up batch',
            description: 'Create a fresh task board after terminal tasks.',
          },
          {
            subject: 'Wire follow-up work',
            description: 'Continue with the new execution batch.',
          },
          {
            subject: 'Verify follow-up work',
            description: 'Confirm the new batch can proceed.',
          },
        ],
      },
      context,
    )
    assert.equal(nextBatch.output.tasks[0]?.subject, 'Start follow-up batch')
    const nextBoard = await loadExecutionTaskBoardForSession(session.sessionId, env)
    assert.equal(nextBoard?.executionState, 'active')
    assert.equal(nextBoard?.tasks[0]?.subject, 'Start follow-up batch')
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('TaskUpdate returns a non-throwing not-found result when the task is missing', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-update-missing-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-update-missing',
      env,
    })
    const context = createToolContext({
      cwd: '/tmp/project',
      sessionId: session.sessionId,
    })

    const result = await taskUpdateTool.call(
      {
        taskId: '404',
        status: 'completed',
      },
      context,
    )

    assert.deepEqual(result.output, {
      success: false,
      taskId: '404',
      updatedFields: [],
      error: 'Task not found',
    })
    assert.match(result.summary ?? '', /Task not found/)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
