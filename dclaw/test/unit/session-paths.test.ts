import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBackgroundTasksDir,
  getDclawHomeDir,
  getQueryTracesDir,
  getSessionsDir,
  getToolResultsDir,
} from '../../src/session/paths.js'

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

test('getSessionsDir uses configured DCLAW_HOME', () => {
  assert.equal(
    getSessionsDir({
      HOME: '/tmp/example-home',
      DCLAW_HOME: '/tmp/dev-dclaw',
    } as NodeJS.ProcessEnv),
    '/tmp/dev-dclaw/sessions',
  )
})

test('query trace, background tasks, and tool results use configured DCLAW_HOME', () => {
  const env = {
    HOME: '/tmp/example-home',
    DCLAW_HOME: '/tmp/dev-dclaw',
  } as NodeJS.ProcessEnv

  assert.equal(getQueryTracesDir(env), '/tmp/dev-dclaw/query-traces')
  assert.equal(getBackgroundTasksDir(env), '/tmp/dev-dclaw/background-tasks')
  assert.equal(getToolResultsDir(env), '/tmp/dev-dclaw/tool-results')
})
