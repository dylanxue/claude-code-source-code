import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getMemoryDir,
  getMemoryEntrypointPath,
  getMemoryProjectsDir,
  sanitizeMemoryProjectKey,
} from '../../src/memory/paths.js'

test('memory paths use DCLAW_HOME projects/<workspace>/memory layout', () => {
  const env = {
    HOME: '/tmp/example-home',
    DCLAW_HOME: '/tmp/dev-dclaw',
  } as NodeJS.ProcessEnv

  const workspaceRoot = '/tmp/workspaces/demo app'
  const projectKey = sanitizeMemoryProjectKey(workspaceRoot)

  assert.equal(getMemoryProjectsDir(env), '/tmp/dev-dclaw/projects')
  assert.equal(
    getMemoryDir(workspaceRoot, env),
    join('/tmp/dev-dclaw/projects', projectKey, 'memory'),
  )
  assert.equal(
    getMemoryEntrypointPath(workspaceRoot, env),
    join('/tmp/dev-dclaw/projects', projectKey, 'memory', 'MEMORY.md'),
  )
})

test('sanitizeMemoryProjectKey resolves relative workspaces before sanitizing', () => {
  const relativeWorkspace = './tmp/project with spaces'
  const expected = resolve(relativeWorkspace).replace(/[^a-zA-Z0-9]/g, '-')

  assert.equal(sanitizeMemoryProjectKey(relativeWorkspace), expected)
})
