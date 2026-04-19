import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { maybeHandleReplCommand } from '../../src/cli/replCommands.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createTextMessage } from '../../src/types/message.js'
import type { CommonCliOptions } from '../../src/cli/types.js'
import {
  appendSessionMessages,
  createSession,
  loadSessionMeta,
} from '../../src/session/store.js'
import {
  createSessionTask,
  loadTaskBoardForSession,
} from '../../src/tasks/store.js'
import type { ReplSessionState } from '../../src/cli/replCommands.js'

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

function createCommandContext() {
  return {
    engine: createEngine(),
    options: createOptions(),
    session: {
      sessionId: 'session-123',
      mode: 'interactive',
      provider: 'stub',
      providerSource: 'default',
      model: 'stub-model',
      modelSource: 'default',
      permissionMode: 'default',
      permissionModeSource: 'default',
    } satisfies ReplSessionState,
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
      ...createCommandContext(),
    })

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /REPL commands:/)
  assert.match(text, /\/session/)
  assert.match(text, /\/info/)
  assert.match(text, /\/doctor/)
  assert.match(text, /\/model/)
  assert.match(text, /\/permissions/)
  assert.match(text, /\/plan/)
  assert.match(text, /\/config/)
  assert.match(text, /\/transcript/)
  assert.match(text, /\/resume/)
  assert.match(text, /\/compact/)
  assert.match(text, /\/clear/)
  assert.match(text, /\/cls/)
  assert.match(text, /\/history/)
  assert.match(text, /\/exit/)
})

test('maybeHandleReplCommand prints diagnostics for /doctor', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/doctor', createCommandContext())

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /dclaw doctor/)
  assert.match(text, /session id/)
  assert.match(text, /compact pressure\s+low \(thresholds unavailable\)/)
  assert.match(text, /compact recommendation/)
  assert.match(text, /compact tokens\s+\d+ \(thresholds unavailable\)/)
  assert.match(text, /compact remaining\s+unknown/)
  assert.match(text, /compact used\s+unknown/)
  assert.match(text, /compact thresholds\s+unavailable/)
  assert.match(text, /max iterations\s+\d+ \((default|user_config)\)/)
  assert.match(text, /provider/)
  assert.match(text, /resolved model/)
  assert.match(text, /max retries/)
  assert.match(text, /retry backoff/)
})

test('maybeHandleReplCommand shows and updates the current model for /model', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    assert.equal(await maybeHandleReplCommand('/model', context), true)
    assert.equal(await maybeHandleReplCommand('/model new-model', context), true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /Current model: stub-model/)
  assert.match(text, /Model updated for this REPL session: new-model/)
  assert.equal(context.session.model, 'new-model')
  assert.equal(context.session.modelSource, 'repl_command')
  assert.equal(context.engine.getMessages().length, 2)
})

test('maybeHandleReplCommand shows and updates the current permission mode for /permissions', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    assert.equal(await maybeHandleReplCommand('/permissions', context), true)
    assert.equal(
      await maybeHandleReplCommand('/permissions bypass-permissions', context),
      true,
    )
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /Current permission mode: default/)
  assert.match(text, /Available modes: default, accept-edits, bypass-permissions, plan/)
  assert.match(
    text,
    /Permission mode updated for this REPL session: bypass-permissions/,
  )
  assert.equal(context.session.permissionMode, 'bypass-permissions')
  assert.equal(context.session.permissionModeSource, 'repl_command')
})

test('maybeHandleReplCommand enters and exits plan mode with /plan', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-plan-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()

  try {
    process.env = env
    await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: context.session.sessionId,
      env,
    })

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    assert.equal(await maybeHandleReplCommand('/plan', context), true)
    const board = await loadTaskBoardForSession(context.session.sessionId, env)
    assert.ok(board?.planFilePath)
    assert.equal(existsSync(board.planFilePath), true)
    assert.equal(await maybeHandleReplCommand('/plan exit', context), true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Entered plan mode for this REPL session\./)
  assert.match(text, /plan mode: active/)
  assert.match(text, /plan file:/)
  assert.match(text, /Exited plan mode\. Restored permission mode: default/)
  assert.equal(context.session.permissionMode, 'default')
})

test('maybeHandleReplCommand manages task state via /plan start', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-task-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()

  try {
    process.env = env
    await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: context.session.sessionId,
      env,
    })

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    assert.equal(await maybeHandleReplCommand('/plan', context), true)
    assert.equal(
      await maybeHandleReplCommand('/plan start implement recall', context),
      true,
    )
    assert.equal(await maybeHandleReplCommand('/plan', context), true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Started task: implement recall/)
  assert.match(text, /current task: implement recall/)
  assert.match(text, /current step: <none>/)
})

test('maybeHandleReplCommand prints config sources for /config', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-config-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    process.env = env
    const configDir = join(homeDir, '.dclaw')
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({
        OPENAI_MODEL: 'user-model',
      }),
      'utf8',
    )

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/config', createCommandContext())

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /dclaw config/)
  assert.match(text, /user config path:/)
  assert.match(text, /user config: loaded/)
  assert.match(text, /workspace config path:/)
  assert.match(text, /workspace config: not found/)
  assert.match(text, /config-backed env keys:/)
  assert.match(text, /OPENAI_MODEL \(user_config\)/)
})

test('maybeHandleReplCommand prints current session info for /session', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/session', createCommandContext())

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /current session:/)
  assert.match(text, /session id: session-123/)
  assert.match(text, /mode: interactive/)
  assert.match(text, /provider: stub/)
  assert.match(text, /model: stub-model/)
  assert.match(text, /permission mode: default/)
  assert.match(text, /compact pressure: low \(thresholds unavailable\)/)
  assert.match(text, /compact dry-run recommendation: no immediate compact needed/)
  assert.match(text, /compact tokens: \d+ used \(model limits unavailable\)/)
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

    const handled = await maybeHandleReplCommand(
      '/transcript',
      createCommandContext(),
    )

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /current transcript:/)
  assert.match(text, /user: hello/)
  assert.match(text, /assistant: hi there/)
})

test('maybeHandleReplCommand supports limiting transcript output', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand(
      '/transcript 1',
      createCommandContext(),
    )

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /current transcript \(latest 1 messages\):/)
  assert.match(text, /assistant: hi there/)
  assert.doesNotMatch(text, /user: hello/)
})

test('maybeHandleReplCommand reports invalid transcript limits locally', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand(
      '/transcript nope',
      createCommandContext(),
    )

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /Invalid transcript limit/)
})

test('maybeHandleReplCommand resets engine state and updates session info on /clear', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-clear-state-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()
  const previousSessionId = context.session.sessionId

  try {
    process.env = env
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/clear', context)

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Started a new empty session\./)
  assert.notEqual(context.session.sessionId, previousSessionId)
  assert.equal(context.session.mode, 'interactive')
  assert.deepEqual(context.engine.getMessages(), [])
})

test('maybeHandleReplCommand leaves plan mode when /clear starts a fresh session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-clear-plan-state-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()
  let newMeta:
    | Awaited<ReturnType<typeof loadSessionMeta>>
    | undefined
    | null

  try {
    process.env = env
    await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: context.session.sessionId,
      env,
    })
    await maybeHandleReplCommand('/plan', context)
    assert.equal(context.session.permissionMode, 'plan')

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/clear', context)

    assert.equal(handled, true)
    newMeta = await loadSessionMeta(context.session.sessionId, env)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Started a new empty session\./)
  assert.equal(context.session.permissionMode, 'default')
  assert.equal(context.engine.getPlanFilePath(), undefined)
  assert.ok(newMeta)
  assert.equal(newMeta?.taskBoardId, undefined)
})

test('maybeHandleReplCommand compacts the conversation into a summary within the current session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-compact-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()
  const previousSessionId = context.session.sessionId

  try {
    process.env = env
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/compact keep the key points', context)

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Compacted conversation into a summary within the current session\./)
  assert.equal(context.session.sessionId, previousSessionId)
  const messages = context.engine.getMessages()
  assert.equal(messages.length, 4)
  assert.ok(messages[2]?.compactBoundary)
  assert.match(messages[3]?.content[0]?.type ?? '', /text/)
  const summaryText = (messages[3]?.content[0] as { text?: string }).text ?? ''
  assert.match(text, /session id: session-123/)
  assert.match(text, /compact boundary: manual compact boundary compact_/)
  assert.match(text, /context snapshot: /)
  assert.match(summaryText, /Compact summary from earlier in this session\./)
  assert.match(summaryText, /boundary: manual compact boundary compact_/)
  assert.match(
    summaryText,
    /Primary request: continue the current session with a compacted summary\./,
  )
  assert.doesNotMatch(summaryText, /Transcript summary:/)
})

test('maybeHandleReplCommand clears the terminal for /cls', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/cls', createCommandContext())

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  assert.equal(output.join(''), '\x1b[2J\x1b[H')
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
      ...createCommandContext(),
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

test('maybeHandleReplCommand resumes a saved session and restores its messages', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-resume-cmd-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'restored-model',
      env,
    })

    context.session.model = 'stub-model'
    context.session.modelSource = 'default'

    context.engine.resetMessages([
      createTextMessage('user', 'before resume'),
    ])

    await appendSessionMessages(
      session.sessionId,
      [
        createTextMessage('user', 'restored user'),
        createTextMessage('assistant', 'restored assistant'),
      ],
      env,
    )

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand(
      `/resume ${session.sessionId}`,
      context,
    )

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Resumed session:/)
  assert.doesNotMatch(text, /last compact boundary:/)
  assert.match(text, /restored transcript preview:/)
  assert.equal(context.session.mode, 'resume')
  assert.equal(context.engine.getMessages().length, 2)
  assert.equal(context.session.model, 'restored-model')
  assert.equal(context.session.modelSource, 'resumed_session')
})

test('maybeHandleReplCommand rotates query trace paths when switching sessions', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-query-trace-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const rotatedSessionIds: string[] = []
  const context = {
    ...createCommandContext(),
    rotateQueryTrace: async (sessionId?: string) => {
      rotatedSessionIds.push(sessionId ?? '<none>')
      return sessionId
        ? `/tmp/query-traces/${sessionId}.jsonl`
        : undefined
    },
  }

  try {
    process.env = env
    const resumedSession = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'trace-model',
      env,
    })
    await appendSessionMessages(
      resumedSession.sessionId,
      [
        createTextMessage('user', 'restored user'),
        createTextMessage('assistant', 'restored assistant'),
      ],
      env,
    )

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    assert.equal(
      await maybeHandleReplCommand(`/resume ${resumedSession.sessionId}`, context),
      true,
    )
    const resumedTraceSessionId = context.session.sessionId
    assert.equal(await maybeHandleReplCommand('/clear', context), true)
    const clearedTraceSessionId = context.session.sessionId

    assert.deepEqual(rotatedSessionIds, [
      resumedTraceSessionId,
      clearedTraceSessionId,
    ])
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, new RegExp(`query trace: /tmp/query-traces/${rotatedSessionIds[0]}\\.jsonl`))
  assert.match(text, new RegExp(`query trace: /tmp/query-traces/${rotatedSessionIds[1]}\\.jsonl`))
})

test('maybeHandleReplCommand does not materialize a plan file when resuming a task-only session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-resume-task-only-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()
  let board: Awaited<ReturnType<typeof loadTaskBoardForSession>> | undefined | null

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'task-only-model',
      sessionId: 'task-only-session',
      env,
    })
    await createSessionTask(
      session.sessionId,
      '/tmp/project',
      {
        subject: 'Investigate auth edge cases',
        description: 'Gather the outstanding execution tasks before coding.',
      },
      env,
    )

    context.session.permissionMode = 'plan'
    context.session.permissionModeSource = 'repl_command'
    context.engine.setPermissionMode('plan')
    context.engine.setPlanFilePath('/tmp/project/old-plan.md')

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand(
      `/resume ${session.sessionId}`,
      context,
    )

    assert.equal(handled, true)
    board = await loadTaskBoardForSession('task-only-session', env)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /plan mode state: inactive/)
  assert.doesNotMatch(text, /plan file:/)
  assert.equal(context.session.permissionMode, 'default')
  assert.equal(context.engine.getPlanFilePath(), undefined)
  assert.ok(board)
  assert.equal(board?.planFilePath, undefined)
})

test('maybeHandleReplCommand shows recent sessions when /resume has no session id', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-repl-resume-list-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.env = env
    await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'resume-model',
      env,
    })

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleReplCommand('/resume', createCommandContext())

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Usage: \/resume <session-id>/)
  assert.match(text, /Recent sessions:/)
  assert.match(text, /resume-model/)
  assert.match(text, /Use \/resume <session-id> to switch this REPL to one of them\./)
})
