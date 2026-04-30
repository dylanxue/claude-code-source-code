import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBackgroundTasksDir,
  getDclawConfigPath,
  getDclawHomeDir,
  getPlanBoardPath,
  getProjectQueryTracesDir,
  getProjectSessionsDir,
  getSessionExecutionTaskBoardPath,
  getSessionMessagesPath,
  getToolResultsDir,
} from '../../src/session/paths.js'
import { sanitizeMemoryProjectKey } from '../../src/memory/paths.js'

test('getDclawHomeDir defaults to ~/.dclaw', () => {
  assert.equal(
    getDclawHomeDir({ HOME: '/tmp/example-home' } as NodeJS.ProcessEnv),
    '/tmp/example-home/.dclaw',
  )
})

test('getDclawHomeDir uses DCLAW_HOME when configured', () => {
  assert.equal(
    getDclawHomeDir({
      HOME: '/tmp/example-home',
      DCLAW_HOME: '/tmp/dev-dclaw',
    } as NodeJS.ProcessEnv),
    '/tmp/dev-dclaw',
  )
})

test('getDclawHomeDir resolves relative DCLAW_HOME against current cwd', () => {
  assert.equal(
    getDclawHomeDir({
      HOME: '/tmp/example-home',
      DCLAW_HOME: '.dclaw',
    } as NodeJS.ProcessEnv),
    resolve('.dclaw'),
  )
})

test('project session paths use projects/<workspace>/sessions layout', () => {
  const env = {
    HOME: '/tmp/example-home',
    DCLAW_HOME: '/tmp/dev-dclaw',
  } as NodeJS.ProcessEnv
  const workspaceRoot = '/tmp/workspaces/demo app'
  const projectKey = sanitizeMemoryProjectKey(workspaceRoot)

  assert.equal(
    getProjectSessionsDir(workspaceRoot, env),
    `/tmp/dev-dclaw/projects/${projectKey}/sessions`,
  )
  assert.equal(
    getSessionMessagesPath('session-123', workspaceRoot, env),
    `/tmp/dev-dclaw/projects/${projectKey}/sessions/session-123/messages.jsonl`,
  )
  assert.equal(
    getPlanBoardPath('board-123', workspaceRoot, env),
    `/tmp/dev-dclaw/projects/${projectKey}/task-boards/board-123.json`,
  )
  assert.equal(
    getSessionExecutionTaskBoardPath('session-123', workspaceRoot, env),
    `/tmp/dev-dclaw/projects/${projectKey}/sessions/session-123/task-board.json`,
  )
})

test('query trace and tool results use workspace project layout', () => {
  const env = {
    HOME: '/tmp/example-home',
    DCLAW_HOME: '/tmp/dev-dclaw',
  } as NodeJS.ProcessEnv
  const workspaceRoot = '/tmp/workspaces/demo app'
  const projectKey = sanitizeMemoryProjectKey(workspaceRoot)

  assert.equal(
    getProjectQueryTracesDir(workspaceRoot, env),
    `/tmp/dev-dclaw/projects/${projectKey}/query-traces`,
  )
  assert.equal(getBackgroundTasksDir(env), '/tmp/dev-dclaw/background-tasks')
  assert.equal(
    getToolResultsDir(workspaceRoot, env),
    `/tmp/dev-dclaw/projects/${projectKey}/tool-results`,
  )
  assert.equal(
    getToolResultsDir({ ...env, DCLAW_WORKSPACE_ROOT: workspaceRoot }),
    `/tmp/dev-dclaw/projects/${projectKey}/tool-results`,
  )
})

test('getDclawConfigPath uses configured DCLAW_HOME', () => {
  assert.equal(
    getDclawConfigPath({
      HOME: '/tmp/example-home',
      DCLAW_HOME: '/tmp/dev-dclaw',
    } as NodeJS.ProcessEnv),
    '/tmp/dev-dclaw/config.json',
  )
})
