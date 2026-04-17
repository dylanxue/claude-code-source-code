import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../../src/session/store.js'
import { loadTaskBoardForSession } from '../../src/tasks/store.js'
import { taskCreateTool } from '../../src/tools/builtin/taskCreate.js'
import { taskGetTool } from '../../src/tools/builtin/taskGet.js'
import { taskListTool } from '../../src/tools/builtin/taskList.js'
import { taskUpdateTool } from '../../src/tools/builtin/taskUpdate.js'
import { createToolContext } from '../helpers/toolContext.js'

test('TaskCreate, TaskList, and TaskGet align on core Claude Code task fields', async () => {
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
        subject: 'Implement task tools',
        description: 'Add TaskCreate, TaskList, TaskGet, and TaskUpdate.',
        activeForm: 'Implementing task tools',
      },
      context,
    )

    assert.deepEqual(created.output, {
      task: {
        id: '1',
        subject: 'Implement task tools',
      },
    })

    const listed = await taskListTool.call({}, context)
    assert.deepEqual(listed.output.tasks, [
      {
        id: '1',
        subject: 'Implement task tools',
        status: 'pending',
        owner: undefined,
        blockedBy: [],
      },
    ])
    assert.match(listed.summary ?? '', /#1 \[pending\] Implement task tools/)

    const fetched = await taskGetTool.call({ taskId: '1' }, context)
    assert.deepEqual(fetched.output.task, {
      id: '1',
      subject: 'Implement task tools',
      description: 'Add TaskCreate, TaskList, TaskGet, and TaskUpdate.',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    })
    assert.match(fetched.summary ?? '', /Task #1: Implement task tools/)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('TaskUpdate supports status changes, dependencies, metadata merge, and deleted', async () => {
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
        subject: 'Define task schema',
        description: 'Add subject, description, and dependency fields.',
      },
      context,
    )
    await taskCreateTool.call(
      {
        subject: 'Wire task tools',
        description: 'Expose TaskCreate, TaskList, TaskGet, and TaskUpdate.',
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
      success: true,
      taskId: '2',
      updatedFields: ['owner', 'metadata', 'status', 'blockedBy'],
      statusChange: {
        from: 'pending',
        to: 'in_progress',
      },
    })
    assert.match(updated.summary ?? '', /Task #2 marked in_progress/)

    const taskTwo = await taskGetTool.call({ taskId: '2' }, context)
    assert.deepEqual(taskTwo.output.task, {
      id: '2',
      subject: 'Wire task tools',
      description: 'Expose TaskCreate, TaskList, TaskGet, and TaskUpdate.',
      status: 'in_progress',
      blocks: [],
      blockedBy: ['1'],
    })

    const taskOne = await taskGetTool.call({ taskId: '1' }, context)
    assert.deepEqual(taskOne.output.task, {
      id: '1',
      subject: 'Define task schema',
      description: 'Add subject, description, and dependency fields.',
      status: 'pending',
      blocks: ['2'],
      blockedBy: [],
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
    assert.match(completed.summary ?? '', /Call TaskList now to find your next available task/i)

    const deleted = await taskUpdateTool.call(
      {
        taskId: '1',
        status: 'deleted',
      },
      context,
    )

    assert.deepEqual(deleted.output, {
      success: true,
      taskId: '1',
      updatedFields: ['deleted'],
      statusChange: {
        from: 'pending',
        to: 'deleted',
      },
    })

    const listed = await taskListTool.call({}, context)
    assert.deepEqual(listed.output.tasks, [
      {
        id: '2',
        subject: 'Wire task tools',
        status: 'completed',
        owner: 'codex',
        blockedBy: [],
      },
    ])

    const board = await loadTaskBoardForSession(session.sessionId, env)
    assert.ok(board)
    assert.equal(board.currentTaskId, undefined)
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
