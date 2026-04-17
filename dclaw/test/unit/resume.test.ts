import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runResume } from '../../src/cli/resume.js'
import { compactSession } from '../../src/compact/compactSession.js'
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
        createMessage('user', [
          {
            type: 'tool_result',
            toolUseId: 'tool_1',
            output: {
              type: 'persisted_tool_result',
              toolName: 'Read',
              summary: 'Read output persisted',
              filepath: '/tmp/dclaw/tool-results/read.txt',
              originalSizeChars: 123456,
              preview: 'preview',
              truncated: true,
            },
            rawOutput: {
              ok: true,
              summary: 'Read /tmp/example.txt',
            },
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
  assert.match(text, /persisted tool results: 1/)
  assert.match(
    text,
    /last persisted tool result: \/tmp\/dclaw\/tool-results\/read\.txt/,
  )
  assert.match(text, /restored transcript:/)
  assert.match(text, /user: Inspect the file/)
  assert.match(text, /assistant: Need to inspect first\./)
  assert.match(text, /\[reasoning\] Inspect before using Read\./)
  assert.match(text, /\[tool use\] Read /)
  assert.match(
    text,
    /tool result \(tool_1\): Read \/tmp\/example\.txt \[model output persisted to \/tmp\/dclaw\/tool-results\/read\.txt\]/,
  )
  assert.match(
    text,
    /Interactive REPL requires a TTY when no prompt is provided\./,
  )
})

test('runResume shows compact boundary metadata for compacted sessions', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-resume-compact-'))
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

    const source = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'source-session',
      env,
    })
    const messages = [
      createTextMessage('user', 'make this shorter'),
      createTextMessage('assistant', 'short summary'),
    ]
    await appendSessionMessages(source.sessionId, messages, env)

    const compacted = await compactSession({
      sourceSessionId: source.sessionId,
      messages,
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      reason: 'user requested /compact',
      env,
    })

    await runResume({
      mode: 'resume',
      sessionId: compacted.session.sessionId,
      options: {
        cwd: '/tmp/project',
        permissionMode: 'default',
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
  assert.match(text, /compact boundaries: 1/)
  assert.match(text, /last compact boundary: manual compact boundary compact_/)
  assert.match(text, /restored transcript:/)
})
