import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInteractive } from '../../src/cli/interactive.js'

test('runInteractive reports that a TTY is required when started without a prompt', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-'))
  const env = { ...process.env, HOME: homeDir }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalEnv = process.env
  const output: string[] = []

  try {
    process.env = env
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runInteractive({
      mode: 'interactive',
      options: {
        cwd: '/tmp/project',
        stream: false,
        verbose: false,
        outputFormat: 'text',
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /dclaw interactive mode is ready\./)
  assert.match(text, /initial prompt: <none>/)
  assert.match(
    text,
    /Interactive REPL requires a TTY when no prompt is provided\./,
  )
})
