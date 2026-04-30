import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runResume } from '../../src/cli/resume.js'
import { compactSession } from '../../src/compact/compactSession.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import {
  appendSessionMessages,
  createSession,
  ensureSessionPlanFile,
  updateSessionPlanMode,
} from '../../src/session/store.js'
import { createPlanSnapshotMessage } from '../../src/planboard/planSnapshots.js'
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
  assert.match(text, /Reasoning: Inspect before using Read\./)
  assert.match(text, /Read \/tmp\/example\.txt/)
  assert.match(
    text,
    /Read \/tmp\/example\.txt \(saved to \/tmp\/dclaw\/tool-results\/read\.txt; preview\)/,
  )
  assert.doesNotMatch(text, /Interactive TUI requires a TTY/)
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
      client: new StubLlmClient(),
      env,
    })

    await runResume({
      mode: 'resume',
      sessionId: compacted.session.sessionId,
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
  assert.match(text, /restored transcript:/)
})

test('runResume prints planning summary for sessions with an attached plan board', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-resume-plan-'))
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
      sessionId: 'resume-plan-session',
      env,
    })
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'active',
        planFilePath: filePath,
      }),
      env,
    )
    await appendSessionMessages(
      session.sessionId,
      [createTextMessage('user', 'continue planning')],
      env,
    )

    await runResume({
      mode: 'resume',
      sessionId: session.sessionId,
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
  assert.match(text, /plan mode: active/)
  assert.match(text, /plan file:/)
  assert.doesNotMatch(text, /current task:/)
  assert.doesNotMatch(text, /current step:/)
})

test('runResume recovers a missing plan file for inactive sessions from transcript snapshots', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-resume-plan-recovery-'))
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
      sessionId: 'resume-plan-recovery-session',
      env,
    })
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    const recoveredPlan = [
      '# Plan',
      '',
      '## Goal',
      '- Recover the missing planning document from transcript clues.',
    ].join('\n')
    await writeFile(filePath, recoveredPlan, 'utf8')
    await appendSessionMessages(
      session.sessionId,
      [createPlanSnapshotMessage(filePath, recoveredPlan, 'test-seed')],
      env,
    )
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'inactive',
        planFilePath: filePath,
      }),
      env,
    )
    await unlink(filePath)

    await runResume({
      mode: 'resume',
      sessionId: session.sessionId,
      options: {
        cwd: '/tmp/project',
        permissionMode: 'default',
        stream: false,
      },
    })

    const restored = await readFile(filePath, 'utf8')
    assert.equal(restored.trimEnd(), recoveredPlan)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /plan mode: inactive/)
  assert.match(text, /plan file:/)
  assert.match(text, /permission mode: default/)
})

test('runResume recovers active Plan Mode with a missing plan file', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-resume-active-plan-recovery-'))
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
      sessionId: 'resume-active-plan-recovery-session',
      env,
    })
    const { filePath } = await ensureSessionPlanFile(session.sessionId, env)
    const recoveredPlan = [
      '# Plan',
      '',
      '## Goal',
      '- Resume active planning with the recovered plan file.',
    ].join('\n')
    await writeFile(filePath, recoveredPlan, 'utf8')
    await appendSessionMessages(
      session.sessionId,
      [createPlanSnapshotMessage(filePath, recoveredPlan, 'test-seed')],
      env,
    )
    await updateSessionPlanMode(
      session.sessionId,
      current => ({
        ...(current ?? { status: 'inactive' as const }),
        status: 'active',
        planFilePath: filePath,
      }),
      env,
    )
    await unlink(filePath)

    await runResume({
      mode: 'resume',
      sessionId: session.sessionId,
      options: {
        cwd: '/tmp/project',
        permissionMode: 'default',
        stream: false,
      },
    })

    const restored = await readFile(filePath, 'utf8')
    assert.equal(restored.trimEnd(), recoveredPlan)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /plan mode: active/)
  assert.match(text, /permission mode: plan/)
  assert.match(text, /permission mode source: plan_mode/)
  assert.match(text, /plan file:/)
})
