import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runHistory } from '../../src/cli/history.js'
import { compactSession } from '../../src/compact/compactSession.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { listSessionHistory } from '../../src/session/history.js'
import {
  appendSessionMessages,
  createSession,
  ensureSessionPlanFile,
  updateSessionPlanMode,
} from '../../src/session/store.js'
import { createMessage, createTextMessage } from '../../src/types/message.js'

test('listSessionHistory sorts sessions by updatedAt descending', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-'))
  const env = { ...process.env, HOME: homeDir }
  const cwd = '/tmp/history'

  try {
    const first = await createSession({
      cwd,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-one',
      env,
    })
    await appendSessionMessages(first.sessionId, [createTextMessage('user', 'first')], env)

    const second = await createSession({
      cwd,
      mode: 'exec',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-two',
      env,
    })
    await createSession({
      cwd,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-empty',
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

    const sessions = await listSessionHistory(cwd, env)

    assert.equal(sessions.length, 2)
    assert.equal(
      sessions.some(session => session.meta.sessionId === 'session-empty'),
      false,
    )
    assert.equal(sessions[0]?.meta.sessionId, 'session-two')
    assert.equal(sessions[0]?.conversationTitle, 'second')
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

test('listSessionHistory derives conversation titles from recent meaningful user messages', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-title-'))
  const env = { ...process.env, HOME: homeDir }
  const cwd = '/tmp/title'

  try {
    const session = await createSession({
      cwd,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-title',
      env,
    })
    await appendSessionMessages(
      session.sessionId,
      [
        createTextMessage('user', '继续开发13.5阶段4'),
        createTextMessage('assistant', '好的'),
        createTextMessage(
          'user',
          '<system-reminder>Task board updated</system-reminder>',
        ),
        createTextMessage('user', '继续'),
      ],
      env,
    )

    const sessions = await listSessionHistory(cwd, env)

    assert.equal(sessions[0]?.conversationTitle, '继续开发13.5阶段4')
    assert.equal(sessions[0]?.lastUserText, '继续')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('listSessionHistory is scoped to the requested workspace', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-workspace-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const one = await createSession({
      cwd: '/tmp/workspace-one',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-workspace-one',
      env,
    })
    const two = await createSession({
      cwd: '/tmp/workspace-two',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-workspace-two',
      env,
    })
    await appendSessionMessages(
      one.sessionId,
      [createTextMessage('user', 'one')],
      { ...env, DCLAW_WORKSPACE_ROOT: '/tmp/workspace-one' },
    )
    await appendSessionMessages(
      two.sessionId,
      [createTextMessage('user', 'two')],
      { ...env, DCLAW_WORKSPACE_ROOT: '/tmp/workspace-two' },
    )

    const oneHistory = await listSessionHistory('/tmp/workspace-one', env)
    const twoHistory = await listSessionHistory('/tmp/workspace-two', env)

    assert.deepEqual(
      oneHistory.map(session => session.meta.sessionId),
      ['session-workspace-one'],
    )
    assert.deepEqual(
      twoHistory.map(session => session.meta.sessionId),
      ['session-workspace-two'],
    )
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
      runtimeName: 'default',
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
  assert.match(text, /runtime: default/)
  assert.match(text, /provider\/model: stub \/ stub-model/)
  assert.match(text, /last user: Inspect the file/)
  assert.match(text, /last assistant: Inspect before using Read\./)
  assert.match(text, /last bash sandbox: danger-full-access/)
  assert.match(text, /persisted tool results: 1/)
  assert.match(
    text,
    /last persisted tool result: \/tmp\/dclaw\/tool-results\/bash\.txt/,
  )
})

test('runHistory can write to a provided output writer', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-history-writer-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []

  try {
    process.env = env

    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      runtimeName: 'default',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-history-writer',
      env,
    })
    await appendSessionMessages(
      session.sessionId,
      [createTextMessage('user', 'Inspect the file')],
      env,
    )

    await runHistory(
      {
        mode: 'history',
        options: {
          cwd: '/tmp/project',
          permissionMode: 'default',
          stream: false,
        },
      },
      {
        writeOutput(text) {
          output.push(text)
        },
      },
    )
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /dclaw history/)
  assert.match(text, /session-history-writer/)
  assert.match(text, /last user: Inspect the file/)
})

test('runHistory prints planning summary from session plan mode', async () => {
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
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'active',
        planFilePath: filePath,
        resumePermissionMode: 'default',
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
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /session-history-plan/)
  assert.match(text, /plan mode: active/)
  assert.match(text, /plan file:/)
  assert.match(text, /resume permissions: default/)
  assert.doesNotMatch(text, /board title:/)
  assert.doesNotMatch(text, /board purpose:/)
  assert.doesNotMatch(text, /board plan:/)
  assert.doesNotMatch(text, /current task:/)
  assert.doesNotMatch(text, /current step:/)
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
      client: new StubLlmClient(),
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
