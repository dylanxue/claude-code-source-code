import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runHistory } from '../../src/cli/history.js'
import { listSessionHistory } from '../../src/session/history.js'
import { appendSessionMessages, createSession } from '../../src/session/store.js'
import { createMessage, createTextMessage } from '../../src/types/message.js'

test('listSessionHistory sorts sessions by updatedAt descending', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const first = await createSession({
      cwd: '/tmp/one',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-one',
      env,
    })
    await appendSessionMessages(first.sessionId, [createTextMessage('user', 'first')], env)

    const second = await createSession({
      cwd: '/tmp/two',
      mode: 'print',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-two',
      env,
    })
    await appendSessionMessages(
      second.sessionId,
      [
        createTextMessage('user', 'second'),
        createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'Read',
            input: { file_path: '/tmp/two.txt' },
          },
        ]),
        createMessage('user', [
          {
            type: 'tool_result',
            toolUseId: 'tool_1',
            output: {
              ok: true,
              summary: 'Ran pwd',
              output: {
                sandboxMode: 'restricted',
              },
            },
          },
        ]),
      ],
      env,
    )

    const sessions = await listSessionHistory(env)

    assert.equal(sessions.length, 2)
    assert.equal(sessions[0]?.meta.sessionId, 'session-two')
    assert.equal(sessions[0]?.lastUserText, 'second')
    assert.equal(sessions[0]?.lastAssistantText, '[tool use] Read')
    assert.equal(sessions[0]?.lastBashSandboxMode, 'restricted')
    assert.equal(sessions[1]?.meta.sessionId, 'session-one')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('runHistory prints recent sessions', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const originalWrite = process.stdout.write.bind(process.stdout)
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
      sessionId: 'session-history',
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
        ]),
        createMessage('user', [
          {
            type: 'tool_result',
            toolUseId: 'tool_2',
            output: {
              ok: true,
              summary: 'Ran Bash',
              output: {
                sandboxMode: 'danger-full-access',
              },
            },
          },
        ]),
      ],
      env,
    )

    await runHistory({
      mode: 'history',
      options: {
        cwd: '/tmp/project',
        permissionMode: 'default',
        stream: false,
        outputFormat: 'text',
        verbose: true,
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /dclaw history/)
  assert.match(text, /session-history/)
  assert.match(text, /last user: Inspect the file/)
  assert.match(text, /last assistant: \[reasoning\] Inspect before using Read\./)
  assert.match(text, /last bash sandbox: danger-full-access/)
  assert.match(text, /resume: dclaw resume session-history/)
})
