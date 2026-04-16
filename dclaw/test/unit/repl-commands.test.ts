import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { maybeHandleReplCommand } from '../../src/cli/replCommands.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createTextMessage } from '../../src/types/message.js'
import type { CommonCliOptions } from '../../src/cli/types.js'
import { createSession } from '../../src/session/store.js'

function createEngine() {
  return new QueryEngine({
    client: new StubLlmClient(),
    model: 'stub-model',
    toolRegistry: createDefaultToolRegistry(),
    toolContext: {
      cwd: '/tmp/project',
      availableTools: [],
      permissionMode: 'default',
      readState: new Map(),
    },
    initialMessages: [
      createTextMessage('user', 'hello'),
      createTextMessage('assistant', 'hi there'),
    ],
  })
}

function createOptions(): CommonCliOptions {
  return {
    cwd: '/tmp/project',
    stream: false,
    verbose: false,
    outputFormat: 'text',
  }
}

test('maybeHandleReplCommand prints help for /help', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/help', {
      engine: createEngine(),
      options: createOptions(),
      mode: 'interactive',
    })

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /REPL commands:/)
  assert.match(text, /\/transcript/)
  assert.match(text, /\/history/)
  assert.match(text, /\/exit/)
})

test('maybeHandleReplCommand prints current transcript for /transcript', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/transcript', {
      engine: createEngine(),
      options: createOptions(),
      mode: 'interactive',
    })

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /current transcript:/)
  assert.match(text, /user: hello/)
  assert.match(text, /assistant: hi there/)
})

test('maybeHandleReplCommand delegates /history to session history output', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-history-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    process.env = env
    await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      env,
    })

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/history', {
      engine: createEngine(),
      options: createOptions(),
      mode: 'interactive',
    })

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /dclaw history/)
  assert.match(text, /sessions: 1/)
})
