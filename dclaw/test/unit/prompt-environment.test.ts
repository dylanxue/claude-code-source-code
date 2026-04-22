import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadPromptEnvironmentContext } from '../../src/prompt/environment.js'

const execFileAsync = promisify(execFile)

test('loadPromptEnvironmentContext reports non-git directories without git status', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dclaw-prompt-env-'))

  try {
    const context = await loadPromptEnvironmentContext(cwd)

    assert.equal(typeof context.currentDate, 'string')
    assert.equal(context.currentDate.length > 0, true)
    assert.equal(typeof context.platform, 'string')
    assert.equal(typeof context.shell, 'string')
    assert.equal(typeof context.osVersion, 'string')
    assert.equal(context.isGitRepository, false)
    assert.equal(context.gitStatus, undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('loadPromptEnvironmentContext includes git status for git repositories', async t => {
  try {
    await execFileAsync('git', ['--version'])
  } catch {
    t.skip('git is not installed')
    return
  }

  const cwd = await mkdtemp(join(tmpdir(), 'dclaw-prompt-env-git-'))

  try {
    await execFileAsync('git', ['init'], { cwd })
    await writeFile(join(cwd, 'note.txt'), 'hello\n', 'utf8')

    const context = await loadPromptEnvironmentContext(cwd)

    assert.equal(context.isGitRepository, true)
    assert.equal(typeof context.gitStatus, 'string')
    assert.match(context.gitStatus ?? '', /\?\? note\.txt/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
