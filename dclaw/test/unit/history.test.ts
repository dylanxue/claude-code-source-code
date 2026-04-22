import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runHistory } from '../../src/cli/history.js'
import { compactSession } from '../../src/compact/compactSession.js'
import { listSessionHistory } from '../../src/session/history.js'
import { appendSessionMessages, createSession } from '../../src/session/store.js'
import {
  ensureTaskBoardPlanFile,
  getOrCreateTaskBoardForSession,
  updateTaskBoard,
} from '../../src/tasks/store.js'
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
              type: 'persisted_tool_result',
              toolName: 'Read',
              summary: 'Read output persisted',
              filepath: '/tmp/dclaw/tool-results/read.txt',
              originalSizeChars: 123456,
              preview: 'hello',
              truncated: true,
            },
            rawOutput: {
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
    assert.equal(sessions[0]?.lastAssistantText, 'Reading /tmp/two.txt')
    assert.equal(sessions[0]?.lastBashSandboxMode, 'restricted')
    assert.equal(sessions[0]?.persistedToolResultCount, 1)
    assert.equal(
      sessions[0]?.lastPersistedToolResultPath,
      '/tmp/dclaw/tool-results/read.txt',
    )
    assert.equal(sessions[1]?.meta.sessionId, 'session-one')
    assert.equal(sessions[1]?.persistedToolResultCount, 0)
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
              type: 'persisted_tool_result',
              toolName: 'Bash',
              summary: 'Bash output persisted',
              filepath: '/tmp/dclaw/tool-results/bash.txt',
              originalSizeChars: 654321,
              preview: 'preview',
              truncated: true,
            },
            rawOutput: {
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
  assert.match(text, /dclaw history/)
  assert.match(text, /session-history/)
  assert.match(text, /last user: Inspect the file/)
  assert.match(text, /last assistant: Inspect before using Read\./)
  assert.match(text, /last bash sandbox: danger-full-access/)
  assert.match(text, /persisted tool results: 1/)
  assert.match(
    text,
    /last persisted tool result: \/tmp\/dclaw\/tool-results\/bash\.txt/,
  )
})

test('runHistory prints planning summary when a task board is attached', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-plan-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-history-plan',
      env,
    })
    const board = await ensureTaskBoardPlanFile(
      await getOrCreateTaskBoardForSession(
        session.sessionId,
        '/tmp/project',
        env,
      ),
      env,
    )
    await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        mode: 'active',
        currentTaskId: '1',
        currentStep: 'Reviewing auth flow',
        tasks: [
          {
            id: '1',
            subject: 'Review auth flow',
            description: 'Review auth flow before implementation',
            status: 'in_progress',
            blocks: [],
            blockedBy: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      }),
      env,
    )
    await appendSessionMessages(
      session.sessionId,
      [createTextMessage('user', 'continue planning')],
      env,
    )

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runHistory({
      mode: 'history',
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
  assert.match(text, /session-history-plan/)
  assert.match(text, /plan mode state: active/)
  assert.match(text, /plan file:/)
  assert.match(text, /current task: Review auth flow/)
  assert.match(text, /current step: Reviewing auth flow/)
})

test('runHistory prints compact boundary metadata for compacted sessions', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-compact-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    process.env = env
    const source = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-compact-source',
      env,
    })
    const messages = [
      createTextMessage('user', 'please summarize'),
      createTextMessage('assistant', 'working on it'),
    ]
    await appendSessionMessages(source.sessionId, messages, env)

    await compactSession({
      sourceSessionId: source.sessionId,
      messages,
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      reason: 'user requested /compact',
      env,
    })

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runHistory({
      mode: 'history',
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
})
