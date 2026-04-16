import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runResume } from '../../src/cli/resume.js'
import { appendSessionMessages, createSession } from '../../src/session/store.js'
import { createMessage, createTextMessage } from '../../src/types/message.js'

test('runResume prints restored transcript when no prompt is provided', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-resume-'))
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

    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      env,
    })

    await appendSessionMessages(
      session.sessionId,
      [
        createTextMessage('user', 'Inspect the file'),
        createMessage('assistant', [
          {
            type: 'reasoning',
            summary: ['Inspect before using Read.'],
            status: 'completed',
          },
          {
            type: 'text',
            text: 'Need to inspect first.',
          },
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'Read',
            input: { file_path: '/tmp/example.txt' },
          },
        ]),
      ],
      env,
    )

    await runResume({
      mode: 'resume',
      sessionId: session.sessionId,
      options: {
        cwd: '/tmp/project',
        permissionMode: 'default',
        stream: false,
        outputFormat: 'text',
        verbose: false,
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /restored transcript:/)
  assert.match(text, /user: Inspect the file/)
  assert.match(text, /assistant: Need to inspect first\./)
  assert.match(text, /\[reasoning\] Inspect before using Read\./)
  assert.match(text, /\[tool use\] Read /)
})
