import { readFile, rm } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { bashTool } from '../../src/tools/builtin/bash.js'
import { createToolContext } from '../helpers/toolContext.js'

test('Bash marks timeout as interrupted', async () => {
  const result = await bashTool.call(
    {
      command: 'node -e "setTimeout(()=>{}, 200)"',
      timeout: 50,
    },
    createToolContext(),
  )

  assert.equal(result.ok, false)
  assert.equal(result.output.exitCode, 124)
  assert.equal(result.output.interrupted, true)
  assert.equal(result.output.returnCodeInterpretation, 'Command timed out')
})

test('Bash run_in_background returns task metadata and writes output to disk', async () => {
  const context = createToolContext()
  const result = await bashTool.call(
    {
      command: 'node -e "setTimeout(()=>console.log(123),100)"',
      run_in_background: true,
    },
    context,
  )

  assert.equal(result.ok, true)
  assert.ok(result.output.backgroundTaskId)
  assert.ok(result.output.persistedOutputPath)

  await new Promise(resolve => setTimeout(resolve, 300))
  const outputPath = result.output.persistedOutputPath!
  const output = await readFile(outputPath, 'utf8')
  assert.match(output, /123/)

  await rm(outputPath, { force: true })
})

test('Bash validate enforces permission mode for dangerouslyDisableSandbox', async () => {
  const blocked = await bashTool.validate?.(
    {
      command: 'pwd',
      dangerouslyDisableSandbox: true,
    },
    createToolContext({ permissionMode: 'default' }),
  )

  const allowed = await bashTool.validate?.(
    {
      command: 'pwd',
      dangerouslyDisableSandbox: true,
    },
    createToolContext({ permissionMode: 'bypass-permissions' }),
  )

  assert.deepEqual(blocked, {
    ok: false,
    error:
      'Bash dangerouslyDisableSandbox requires permission mode bypass-permissions',
  })
  assert.deepEqual(allowed, { ok: true })
})

test('Bash read-only classification distinguishes read and write commands', () => {
  assert.equal(bashTool.isReadOnly?.({ command: 'ls -la' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'grep foo file.txt' }), true)
  assert.equal(
    bashTool.isReadOnly?.({ command: 'TZ=UTC git status --short' }),
    true,
  )
  assert.equal(
    bashTool.isReadOnly?.({
      command: 'NODE_ENV=production grep foo file.txt',
    }),
    true,
  )
  assert.equal(bashTool.isReadOnly?.({ command: 'timeout 5 pwd' }), true)
  assert.equal(
    bashTool.isReadOnly?.({ command: 'nohup -- git status --short' }),
    true,
  )
  assert.equal(
    bashTool.isReadOnly?.({ command: 'nice -n 5 grep foo file.txt' }),
    true,
  )
  assert.equal(bashTool.isReadOnly?.({ command: 'git status --short' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'git diff --stat' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'git branch --show-current' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd > out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'git status --short > out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'grep foo file.txt >> out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'timeout 5 touch file.txt' }), false)
  assert.equal(
    bashTool.isReadOnly?.({ command: 'FOO=bar git status --short' }),
    false,
  )
  assert.equal(bashTool.isReadOnly?.({ command: 'echo "a>b"' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'git branch feature-x' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'touch file.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'echo hello' }), false)
})
