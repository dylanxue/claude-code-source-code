import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../../src/session/store.js'
import {
  extractInitialTasksFromPlan,
  materializeInitialTasksFromPlan,
} from '../../src/tasks/materialize.js'
import { listSessionTasks } from '../../src/tasks/store.js'

test('extractInitialTasksFromPlan creates one task per implementation phase when the plan uses phased headings', () => {
  const drafts = extractInitialTasksFromPlan([
    '# Plan',
    '',
    '## Context',
    '- workspace: /tmp/project',
    '',
    '## 实现步骤',
    '',
    '#### 阶段一：项目初始化',
    '1. 创建项目目录结构',
    '2. 安装依赖',
    '',
    '#### 阶段二：后端开发',
    '1. 集成引擎',
    '2. 编写 API',
    '',
    '## Files',
    '- backend/main.py',
  ].join('\n'))

  assert.deepEqual(drafts, [
    {
      subject: '项目初始化',
      description: ['- 创建项目目录结构', '- 安装依赖'].join('\n'),
    },
    {
      subject: '后端开发',
      description: ['- 集成引擎', '- 编写 API'].join('\n'),
    },
  ])
})

test('extractInitialTasksFromPlan falls back to implementation-step list items when the plan has no phase headings', () => {
  const drafts = extractInitialTasksFromPlan([
    '# Implementation Plan',
    '',
    '## Implementation Steps',
    '1. Create the backend entrypoint',
    '2. Add the frontend shell',
    '3. Verify the app end to end',
  ].join('\n'))

  assert.deepEqual(drafts, [
    {
      subject: 'Create the backend entrypoint',
      description: 'Create the backend entrypoint',
    },
    {
      subject: 'Add the frontend shell',
      description: 'Add the frontend shell',
    },
    {
      subject: 'Verify the app end to end',
      description: 'Verify the app end to end',
    },
  ])
})

test('materializeInitialTasksFromPlan seeds the task board only when it is still empty', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-plan-materialize-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-plan-materialize',
      env,
    })

    const first = await materializeInitialTasksFromPlan(
      session.sessionId,
      '/tmp/project',
      [
        '# Plan',
        '',
        '## 实现步骤',
        '',
        '#### 阶段一：项目初始化',
        '1. 创建目录',
        '2. 初始化依赖',
        '',
        '#### 阶段二：前端开发',
        '1. 创建页面',
      ].join('\n'),
      env,
    )

    assert.deepEqual(first, {
      createdCount: 2,
      skippedBecauseTasksExist: false,
    })

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
          subject: '项目初始化',
          description: ['- 创建目录', '- 初始化依赖'].join('\n'),
        },
        {
          id: '2',
          subject: '前端开发',
          description: '- 创建页面',
        },
      ],
    )

    const second = await materializeInitialTasksFromPlan(
      session.sessionId,
      '/tmp/project',
      [
        '# Plan',
        '',
        '## Implementation Steps',
        '1. This should not duplicate existing work',
      ].join('\n'),
      env,
    )

    assert.deepEqual(second, {
      createdCount: 0,
      skippedBecauseTasksExist: true,
    })
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})
