import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeMemoryProjectKey } from '../../src/memory/paths.js'
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
  assert.equal(result.output.sandboxMode, 'restricted')
  assert.equal(result.output.executionMode, 'foreground')
  assert.equal(result.output.stdoutTruncated, false)
  assert.equal(result.output.stderrTruncated, false)
})

test('Bash run_in_background returns task metadata and writes output to disk', async () => {
  const dclawHome = await mkdtemp(join(tmpdir(), 'dclaw-bash-home-'))
  const originalDclawHome = process.env.DCLAW_HOME
  const context = createToolContext()
  process.env.DCLAW_HOME = dclawHome

  try {
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
    assert.equal(result.output.sandboxMode, 'restricted')
    assert.equal(result.output.executionMode, 'background')
    assert.equal(result.output.stdoutTruncated, false)
    assert.equal(result.output.stderrTruncated, false)
    assert.match(result.output.persistedOutputPath!, /background-tasks/)
    assert.match(result.output.persistedOutputPath!, /dclaw-bash-home-/)

    const outputPath = result.output.persistedOutputPath!
    const deadline = Date.now() + 2_000
    let output = ''

    while (Date.now() < deadline) {
      output = await readFile(outputPath, 'utf8')
      if (/123/.test(output) && /# dclaw background task complete/.test(output)) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }

    assert.match(output, /# dclaw background task/)
    assert.match(output, /# command/)
    assert.match(output, /123/)
    assert.match(output, /# dclaw background task complete/)
    assert.match(output, /# exit_code: 0/)

    await rm(outputPath, { force: true })
  } finally {
    process.env.DCLAW_HOME = originalDclawHome
    await rm(dclawHome, { recursive: true, force: true })
  }
})

test('Bash persists large foreground output with metadata', async () => {
  const dclawHome = await mkdtemp(join(tmpdir(), 'dclaw-bash-home-'))
  const originalDclawHome = process.env.DCLAW_HOME
  const workspaceRoot = join(dclawHome, 'workspace project')
  const expectedToolResultsDir = join(
    dclawHome,
    'projects',
    sanitizeMemoryProjectKey(workspaceRoot),
    'tool-results',
  )
  process.env.DCLAW_HOME = dclawHome

  try {
    await mkdir(workspaceRoot, { recursive: true })
    const result = await bashTool.call(
      {
        command:
          'node -e "process.stdout.write(\'x\'.repeat(13000)); process.stderr.write(\'warn\')"',
      },
      createToolContext({ cwd: workspaceRoot }),
    )

    assert.equal(result.ok, true)
    assert.ok(result.output.persistedOutputPath)
    assert.ok((result.output.persistedOutputSize ?? 0) > 13_000)
    assert.equal(
      dirname(result.output.persistedOutputPath!),
      expectedToolResultsDir,
    )
    assert.equal(result.output.executionMode, 'foreground')
    assert.equal(result.output.stdoutTruncated, true)
    assert.equal(result.output.stderrTruncated, false)

    const persisted = await readFile(result.output.persistedOutputPath!, 'utf8')
    assert.match(persisted, /# dclaw bash output/)
    assert.match(persisted, /mode: foreground/)
    assert.match(persisted, /exit_code: 0/)
    assert.match(persisted, /interrupted: false/)
    assert.match(persisted, /sandbox_mode: restricted/)
    assert.match(persisted, /# command/)
    assert.match(persisted, /# stdout/)
    assert.match(persisted, /# stderr/)
    assert.match(persisted, /warn/)

    await rm(result.output.persistedOutputPath!, { force: true })
  } finally {
    process.env.DCLAW_HOME = originalDclawHome
    await rm(dclawHome, { recursive: true, force: true })
  }
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

test('Bash call rejects dangerouslyDisableSandbox outside bypass-permissions mode', async () => {
  const result = await bashTool.call(
    {
      command: 'pwd',
      dangerouslyDisableSandbox: true,
    },
    createToolContext({ permissionMode: 'default' }),
  )

  assert.equal(result.ok, false)
  assert.equal(result.output.sandboxMode, 'restricted')
  assert.equal(result.output.dangerouslyDisableSandbox, false)
  assert.equal(result.output.executionMode, 'foreground')
  assert.match(
    result.output.stderr,
    /requires permission mode bypass-permissions/,
  )
})

test('Bash uses restricted environment by default and full environment when unsandboxed', async () => {
  const originalValue = process.env.BASH_SECRET_TEST
  process.env.BASH_SECRET_TEST = 'super-secret'

  try {
    const restricted = await bashTool.call(
      {
        command:
          'node -e "process.stdout.write(process.env.BASH_SECRET_TEST ?? \'missing\')"',
      },
      createToolContext(),
    )
    const unsandboxed = await bashTool.call(
      {
        command:
          'node -e "process.stdout.write(process.env.BASH_SECRET_TEST ?? \'missing\')"',
        dangerouslyDisableSandbox: true,
      },
      createToolContext({ permissionMode: 'bypass-permissions' }),
    )

    assert.equal(restricted.ok, true)
    assert.equal(restricted.output.stdout, 'missing')
    assert.equal(restricted.output.sandboxMode, 'restricted')
    assert.equal(restricted.output.dangerouslyDisableSandbox, false)
    assert.equal(restricted.output.executionMode, 'foreground')
    assert.equal(restricted.output.stdoutTruncated, false)

    assert.equal(unsandboxed.ok, true)
    assert.equal(unsandboxed.output.stdout, 'super-secret')
    assert.equal(unsandboxed.output.sandboxMode, 'danger-full-access')
    assert.equal(unsandboxed.output.dangerouslyDisableSandbox, true)
    assert.equal(unsandboxed.output.executionMode, 'foreground')
    assert.equal(unsandboxed.output.stdoutTruncated, false)
  } finally {
    if (originalValue === undefined) {
      delete process.env.BASH_SECRET_TEST
    } else {
      process.env.BASH_SECRET_TEST = originalValue
    }
  }
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
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd 2>&1' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd 1>&2' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd >&1' }), true)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd > out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd 2> err.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd >& out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd >| out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd &> out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'pwd &>> out.txt' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'cat <(pwd)' }), false)
  assert.equal(bashTool.isReadOnly?.({ command: 'grep foo $(pwd)/file.txt' }), false)
  assert.equal(
    bashTool.isReadOnly?.({ command: 'grep foo `pwd`/file.txt' }),
    false,
  )
  assert.equal(
    bashTool.isReadOnly?.({ command: 'git status --short 1>>out.txt 2>&1' }),
    false,
  )
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
