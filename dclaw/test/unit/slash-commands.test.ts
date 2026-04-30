import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { maybeHandleSlashCommand } from '../../src/cli/slashCommands.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createTextMessage } from '../../src/types/message.js'
import type { CommonCliOptions } from '../../src/cli/types.js'
import {
  appendSessionMessages,
  createSession,
  loadSessionMeta,
} from '../../src/session/store.js'
import {
  attachPlanBoardToSession,
  createPlanBoard,
  loadPlanBoardForSession,
} from '../../src/planboard/store.js'
import type {
  SlashCommandContext,
  InteractiveSessionState,
} from '../../src/cli/slashCommands.js'
import { getMemoryEntrypointPath } from '../../src/memory/paths.js'
import { listMemoryFiles, writeMemoryFile } from '../../src/memory/store.js'

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
  }
}

function createCommandContext(
  overrides?: Partial<SlashCommandContext>,
): SlashCommandContext {
  const base = createCommandContextBase()
  return {
    ...base,
    ...overrides,
    options: {
      ...base.options,
      ...(overrides?.options ?? {}),
    },
    session: {
      ...base.session,
      ...(overrides?.session ?? {}),
    },
  }
}

function createCommandContextBase(): SlashCommandContext {
  return {
    engine: createEngine(),
    options: createOptions(),
    session: {
      sessionId: 'session-123',
      mode: 'interactive',
      runtimeName: 'default',
      provider: 'stub',
      providerSource: 'default',
      model: 'stub-model',
      modelSource: 'default',
      permissionMode: 'default',
      permissionModeSource: 'default',
    } satisfies InteractiveSessionState,
  }
}

test('maybeHandleSlashCommand rejects unknown slash commands locally', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    assert.equal(
      await maybeHandleSlashCommand('/model', createCommandContext()),
      true,
    )
    assert.equal(
      await maybeHandleSlashCommand('/doctor', createCommandContext()),
      true,
    )
    assert.equal(
      await maybeHandleSlashCommand('/session', createCommandContext()),
      true,
    )
    assert.equal(
      await maybeHandleSlashCommand('/info', createCommandContext()),
      true,
    )
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /Unknown slash command: \/model/)
  assert.match(text, /Unknown slash command: \/doctor/)
  assert.match(text, /Unknown slash command: \/session/)
  assert.match(text, /Unknown slash command: \/info/)
  assert.match(text, /Type \/ to browse available commands\./)
})

test('maybeHandleSlashCommand can write busy-command output through a supplied writer', async () => {
  const output: string[] = []

  const handled = await maybeHandleSlashCommand(
    '/model',
    createCommandContext(),
    {
      allowDuringActivePrompt: true,
      writeOutput(text) {
        output.push(text)
      },
    },
  )

  assert.equal(handled, true)
  const text = output.join('')
  assert.match(text, /Unknown slash command: \/model/)
  assert.match(text, /Type \/ to browse available commands\./)
})

test('maybeHandleSlashCommand shows the current runtime for /runtime', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-runtime-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-runtime-workspace-'))
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalEnv = process.env

  try {
    process.env = {
      HOME: homeDir,
      PATH: originalEnv.PATH,
    } as NodeJS.ProcessEnv
    await mkdir(join(homeDir, '.dclaw'), { recursive: true })
    await writeFile(
      join(homeDir, '.dclaw', 'config.json'),
      JSON.stringify({
        llm: {
          providers: {
            main: {
              type: 'openai',
              apiKey: 'test-key',
            },
          },
          runtimes: {
            default: {
              primary: {
                providerRef: 'main',
                model: 'gpt-5.4',
              },
            },
            review: {
              primary: {
                providerRef: 'main',
                model: 'gpt-5.4-mini',
              },
              imageFallback: {
                providerRef: 'main',
                model: 'gpt-4.1-mini',
              },
            },
          },
        },
      }),
      'utf8',
    )
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand(
      '/runtime',
      createCommandContext({
        options: {
          ...createOptions(),
          cwd: workspaceDir,
          runtime: 'default',
        },
        session: {
          sessionId: 'session-123',
          mode: 'interactive',
          runtimeName: 'default',
          provider: 'openai',
          providerSource: 'user_config',
          model: 'gpt-5.4',
          modelSource: 'user_config',
          permissionMode: 'default',
          permissionModeSource: 'default',
        },
      }),
    )

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /current runtime:/)
  assert.match(text, /runtime: default/)
  assert.match(text, /provider: openai/)
  assert.match(text, /model: gpt-5\.4/)
  assert.match(text, /available runtimes:/)
  assert.match(text, /\* default  main \/ gpt-5\.4/)
  assert.match(text, /- review  main \/ gpt-5\.4-mini  imageFallback=gpt-4\.1-mini/)
})

test('maybeHandleSlashCommand lists runtimes for /runtime list', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-runtime-list-home-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-runtime-list-workspace-'))
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalEnv = process.env

  try {
    process.env = {
      HOME: homeDir,
      PATH: originalEnv.PATH,
    } as NodeJS.ProcessEnv
    await mkdir(join(homeDir, '.dclaw'), { recursive: true })
    await writeFile(
      join(homeDir, '.dclaw', 'config.json'),
      JSON.stringify({
        llm: {
          providers: {
            main: {
              type: 'openai',
              apiKey: 'test-key',
            },
          },
          runtimes: {
            default: {
              primary: {
                providerRef: 'main',
                model: 'gpt-5.4',
              },
            },
            review: {
              primary: {
                providerRef: 'main',
                model: 'gpt-5.4-mini',
              },
            },
          },
        },
      }),
      'utf8',
    )
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand(
      '/runtime list',
      createCommandContext({
        options: {
          ...createOptions(),
          cwd: workspaceDir,
          runtime: 'review',
        },
      }),
    )

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.doesNotMatch(text, /current runtime:/)
  assert.match(text, /available runtimes:/)
  assert.match(text, /- default  main \/ gpt-5\.4/)
  assert.match(text, /\* review  main \/ gpt-5\.4-mini/)
})

test('maybeHandleSlashCommand switches runtime for /runtime <name>', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext({
    options: {
      ...createOptions(),
      runtime: 'default',
    },
  })
  let switchedTo: string | undefined

  context.switchRuntime = async runtimeName => {
    switchedTo = runtimeName
    context.options.runtime = runtimeName
    context.session.provider = 'anthropic'
    context.session.providerSource = 'workspace_config'
    context.session.model = 'claude-sonnet-4-6'
    context.session.modelSource = 'workspace_config'

    return {
      runtime: {
        runtimeName,
        runtimeSource: 'cli',
        provider: 'anthropic',
        providerSource: 'workspace_config',
        providerRef: 'anthropic-default',
        providerConfig: {
          provider: 'anthropic',
          apiKey: 'test-key',
          baseUrl: 'https://api.anthropic.com',
        },
        model: 'claude-sonnet-4-6',
        canonicalModel: 'claude-sonnet-4-6',
        catalogMatch: 'claude-sonnet-4-6',
        modelSource: 'workspace_config',
        modelLimits: {
          contextWindow: 1_000_000,
          maxOutputTokens: 64_000,
          maxOutputTokensUpperLimit: 64_000,
        },
        modelCapabilities: {
          supportsImageInput: true,
          supportsPdfInput: true,
        },
        primary: {
          providerRef: 'anthropic-default',
          provider: 'anthropic',
          providerConfig: {
            provider: 'anthropic',
            apiKey: 'test-key',
            baseUrl: 'https://api.anthropic.com',
          },
          model: 'claude-sonnet-4-6',
          canonicalModel: 'claude-sonnet-4-6',
          catalogMatch: 'claude-sonnet-4-6',
          modelSource: 'workspace_config',
          modelLimits: {
            contextWindow: 1_000_000,
            maxOutputTokens: 64_000,
            maxOutputTokensUpperLimit: 64_000,
          },
          modelCapabilities: {
            supportsImageInput: true,
            supportsPdfInput: true,
          },
          client: new StubLlmClient(),
        },
      },
      queryTracePath: '/tmp/query-traces/runtime-switch.ndjson',
    }
  }

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand('/runtime anthropic-main', context)

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.equal(switchedTo, 'anthropic-main')
  assert.equal(context.options.runtime, 'anthropic-main')
  assert.equal(context.session.runtimeName, 'anthropic-main')
  assert.equal(context.session.provider, 'anthropic')
  assert.equal(context.session.model, 'claude-sonnet-4-6')
  assert.match(text, /Runtime updated for this interactive session: anthropic-main/)
  assert.match(text, /runtime: anthropic-main/)
  assert.match(text, /provider: anthropic/)
  assert.match(text, /model: claude-sonnet-4-6/)
  assert.match(text, /query trace: \/tmp\/query-traces\/runtime-switch\.ndjson/)
})

test('maybeHandleSlashCommand shows and updates the current permission mode for /permissions', async () => {
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

    assert.equal(await maybeHandleSlashCommand('/permissions', context), true)
    assert.equal(
      await maybeHandleSlashCommand('/permissions bypass-permissions', context),
      true,
    )
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /Current permission mode: default/)
  assert.match(text, /Available modes: default, accept-edits, bypass-permissions/)
  assert.doesNotMatch(text, /Available modes: .*plan/)
  assert.match(
    text,
    /Permission mode updated for this interactive session: bypass-permissions/,
  )
  assert.equal(context.session.permissionMode, 'bypass-permissions')
  assert.equal(context.session.permissionModeSource, 'slash_command')
})

test('maybeHandleSlashCommand lists skills with /skills only', async () => {
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []
  const statuses = [
    {
      name: 'review',
      description: 'Review code changes.',
      source: 'user' as const,
      prompt: 'Review carefully.',
      path: '/tmp/review.md',
      enabled: true,
    },
    {
      name: 'pdf',
      description: 'Analyze PDFs.',
      source: 'builtin' as const,
      prompt: 'Read PDFs.',
      path: '/tmp/pdf.md',
      enabled: false,
    },
  ]
  const context = createCommandContext({
    listSkillStatuses: async () => statuses,
  })

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    assert.equal(await maybeHandleSlashCommand('/skills', context), true)
    assert.equal(await maybeHandleSlashCommand('/skills list', context), true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  const text = output.join('')
  assert.match(text, /Skills:/)
  assert.match(text, /Usage: \/skills/)
  assert.match(text, /enabled\s+review \(user\)\s+Review code changes\./)
  assert.match(text, /disabled\s+pdf \(builtin\)\s+Analyze PDFs\./)
})

test('maybeHandleSlashCommand creates and shows workspace memory with /memory', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-memory-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-memory-workspace-'))
  const env = { ...process.env, HOME: homeDir }
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    const context = createCommandContext({
      options: {
        cwd: workspaceDir,
        stream: false,
      },
      env,
    })
    await writeMemoryFile({
      workspaceRoot: workspaceDir,
      env,
      relativePath: 'project/answer-style.md',
      frontmatter: {
        name: 'Answer Style',
        description: 'Prefer concise direct answers.',
        type: 'feedback',
        updated_at: '2026-04-18T10:00:00.000Z',
      },
      body: 'The user prefers direct answers without long recaps.',
    })
    const handled = await maybeHandleSlashCommand('/memory', context)
    assert.equal(await maybeHandleSlashCommand('/memory list', context), true)
    assert.equal(
      await maybeHandleSlashCommand(
        '/memory view project/answer-style.md',
        context,
      ),
      true,
    )
    assert.equal(
      await maybeHandleSlashCommand(
        '/memory delete project/answer-style.md',
        context,
      ),
      true,
    )
    const entrypoint = await readFile(
      getMemoryEntrypointPath(workspaceDir, env),
      'utf8',
    )

    assert.equal(handled, true)
    const text = output.join('')
    assert.match(text, /Memory:/)
    assert.match(text, /entrypoint:/)
    assert.match(text, /project\/answer-style\.md/)
    assert.match(text, /The user prefers direct answers/)
    assert.match(text, /Deleted memory: project\/answer-style\.md/)
    assert.deepEqual(await listMemoryFiles(workspaceDir, env), [])
    assert.match(entrypoint, /# Memory/)
  } finally {
    process.stdout.write = originalWrite
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('maybeHandleSlashCommand prints current status for /status', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-session-'))
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalEnv = process.env

  try {
    process.env = {
      HOME: homeDir,
      PATH: originalEnv.PATH,
    } as NodeJS.ProcessEnv
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand('/status', createCommandContext())

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /status:/)
  assert.match(text, /session id: session-123/)
  assert.match(text, /runtime: default/)
  assert.match(text, /main model: stub \/ stub-model/)
  assert.match(text, /image model: not configured/)
  assert.match(text, /permission: default/)
  assert.match(text, /directory: \/tmp\/project/)
  assert.match(text, /compact pressure: low \(thresholds unavailable\)/)
  assert.match(text, /token usage: \d+ used \/ total unavailable/)
  assert.doesNotMatch(text, /runtime source:/)
  assert.doesNotMatch(text, /provider source:/)
  assert.doesNotMatch(text, /permission mode:/)
  assert.doesNotMatch(text, /query trace:/)
})

test('maybeHandleSlashCommand shows canonicalized model details in /status', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-session-canonical-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-session-workspace-'))
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalEnv = process.env

  try {
    process.env = {
      HOME: homeDir,
      PATH: originalEnv.PATH,
    } as NodeJS.ProcessEnv
    await mkdir(join(homeDir, '.dclaw'), { recursive: true })
    await writeFile(
      join(homeDir, '.dclaw', 'config.json'),
      JSON.stringify({
        llm: {
          providers: {
            compat: {
              type: 'openai',
              apiKey: 'test-key',
              baseURL: 'https://example.test/v1',
            },
          },
          runtimes: {
            canonical: {
              primary: {
                providerRef: 'compat',
                model: 'anthropic/claude-opus-4.7',
              },
            },
          },
        },
      }),
      'utf8',
    )
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand(
      '/status',
      createCommandContext({
        options: {
          ...createOptions(),
          cwd: workspaceDir,
          runtime: 'canonical',
        },
        session: {
          sessionId: 'session-123',
          mode: 'interactive',
          runtimeName: 'canonical',
          provider: 'openai',
          providerSource: 'user_config',
          model: 'anthropic/claude-opus-4.7',
          modelSource: 'user_config',
          permissionMode: 'default',
          permissionModeSource: 'default',
        },
      }),
    )

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /runtime: canonical/)
  assert.match(text, /main model: openai \/ anthropic\/claude-opus-4\.7/)
  assert.doesNotMatch(text, /model canonicalized to:/)
  assert.doesNotMatch(text, /catalog match:/)
})

test('maybeHandleSlashCommand allows read-only status commands while a response is active', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-busy-status-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.env = env
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand(
      '/status',
      createCommandContext(),
      { allowDuringActivePrompt: true },
    )

    assert.equal(handled, true)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /status:/)
  assert.match(text, /session id:/)
})

test('maybeHandleSlashCommand blocks mutating commands while a response is active', async () => {
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand(
      '/clear',
      createCommandContext(),
      { allowDuringActivePrompt: true },
    )

    assert.equal(handled, true)
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  assert.match(
    output.join(''),
    /\/clear cannot run while a response is active/,
  )
})

test('maybeHandleSlashCommand resets engine state and updates status on /clear', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-clear-state-'))
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

    const handled = await maybeHandleSlashCommand('/clear', context)

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

test('maybeHandleSlashCommand leaves plan mode when /clear starts a fresh session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-clear-plan-state-'))
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
    context.engine.setPermissionMode('plan')
    context.engine.setPlanFilePath('/tmp/project/.dclaw/plans/plan_board_123.md')
    context.session.permissionMode = 'plan'
    context.session.permissionModeSource = 'plan_board'

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand('/clear', context)

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
})

test('maybeHandleSlashCommand toggles plan mode manually with /plan', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-plan-toggle-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
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

    assert.equal(
      await maybeHandleSlashCommand('/plan', context, {
        writeOutput(text) {
          output.push(text)
        },
      }),
      true,
    )

    const activeMeta = await loadSessionMeta(context.session.sessionId, env)
    assert.equal(activeMeta?.planMode?.status, 'active')
    assert.equal(context.session.permissionMode, 'plan')
    assert.equal(context.engine.getPermissionMode(), 'plan')
    assert.equal(context.engine.getPlanFilePath(), activeMeta?.planMode?.planFilePath)
    assert.match(output.join(''), /Entered plan mode/)

    output.length = 0
    assert.equal(
      await maybeHandleSlashCommand('/plan', context, {
        writeOutput(text) {
          output.push(text)
        },
      }),
      true,
    )

    const inactiveMeta = await loadSessionMeta(context.session.sessionId, env)
    assert.equal(inactiveMeta?.planMode?.status, 'inactive')
    assert.equal(inactiveMeta?.planMode?.needsExitReminder, false)
    assert.equal(context.session.permissionMode, 'default')
    assert.equal(context.engine.getPermissionMode(), 'default')
    assert.equal(context.engine.getPlanFilePath(), undefined)
    assert.match(output.join(''), /Exited plan mode/)
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('maybeHandleSlashCommand compacts the conversation into a summary within the current session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-compact-'))
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

    const handled = await maybeHandleSlashCommand('/compact keep the key points', context)

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

test('maybeHandleSlashCommand resumes a saved session and restores its messages', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-resume-cmd-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()
  let resumedSessionId = ''
  let switchedToRuntime: string | undefined
  let resumedMeta:
    | Awaited<ReturnType<typeof loadSessionMeta>>
    | undefined
    | null

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      runtimeName: 'historic-runtime',
      provider: 'stub',
      model: 'restored-model',
      env,
    })
    resumedSessionId = session.sessionId

    context.switchRuntime = async runtimeName => {
      switchedToRuntime = runtimeName
      context.options.runtime = runtimeName
      context.session.runtimeName = runtimeName
      context.session.provider = 'stub'
      context.session.providerSource = 'resume_runtime'
      context.session.model = 'restored-model'
      context.session.modelSource = 'resume_runtime'
      ;(context.engine as unknown as { model?: string }).model = 'restored-model'

      return {
        runtime: {
          runtimeName,
          runtimeSource: 'default',
          provider: 'stub',
          providerSource: 'default',
          providerRef: 'stub-default',
          providerConfig: { provider: 'stub' } as never,
          model: 'restored-model',
          canonicalModel: 'restored-model',
          catalogMatch: 'restored-model',
          modelSource: 'user_config',
          modelLimits: undefined,
          modelCapabilities: {
            supportsImageInput: false,
            supportsPdfInput: false,
          },
          primary: {
            providerRef: 'stub-default',
            provider: 'stub',
            providerConfig: { provider: 'stub' } as never,
            model: 'restored-model',
            canonicalModel: 'restored-model',
            catalogMatch: 'restored-model',
            modelSource: 'user_config',
            modelLimits: undefined,
            modelCapabilities: {
              supportsImageInput: false,
              supportsPdfInput: false,
            },
            client: new StubLlmClient(),
          },
          imageFallback: undefined,
        },
        queryTracePath: undefined,
      }
    }

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

    const handled = await maybeHandleSlashCommand(
      `/resume ${session.sessionId}`,
      context,
    )

    assert.equal(handled, true)
    resumedMeta = await loadSessionMeta(resumedSessionId, env)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /Resumed session:/)
  assert.match(text, /restored runtime: historic-runtime/)
  assert.match(text, /restored provider\/model: stub \/ restored-model/)
  assert.doesNotMatch(text, /last compact boundary:/)
  assert.match(text, /restored transcript preview:/)
  assert.equal(context.session.mode, 'resume')
  assert.equal(switchedToRuntime, 'historic-runtime')
  assert.equal(context.options.runtime, 'historic-runtime')
  assert.equal(context.session.runtimeName, 'historic-runtime')
  assert.equal(context.engine.getMessages().length, 2)
  assert.equal(context.session.model, 'restored-model')
  assert.equal(context.session.modelSource, 'resume_runtime')
  assert.equal((context.engine as unknown as { model?: string }).model, 'restored-model')
  assert.ok(resumedMeta)
  assert.equal(resumedMeta?.runtimeName, 'historic-runtime')
  assert.equal(resumedMeta?.provider, 'stub')
  assert.equal(resumedMeta?.model, 'restored-model')
})

test('maybeHandleSlashCommand rotates query trace paths when switching sessions', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-query-trace-'))
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
      runtimeName: 'historic-runtime',
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
      await maybeHandleSlashCommand(`/resume ${resumedSession.sessionId}`, context),
      true,
    )
    const resumedTraceSessionId = context.session.sessionId
    assert.equal(await maybeHandleSlashCommand('/clear', context), true)
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

test('maybeHandleSlashCommand does not materialize a plan file when resuming an inactive plan-board session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-resume-task-only-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const context = createCommandContext()
  let board: Awaited<ReturnType<typeof loadPlanBoardForSession>> | undefined | null

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      runtimeName: 'historic-runtime',
      provider: 'stub',
      model: 'task-only-model',
      sessionId: 'task-only-session',
      env,
    })
    const planBoard = await createPlanBoard({
      boardId: 'board-task-only',
      workspaceId: '/tmp/project',
      rootSessionId: session.sessionId,
      latestSessionId: session.sessionId,
      brief: {
        title: 'Investigate auth edge cases',
        purpose: 'Gather the outstanding execution tasks before coding.',
      },
      env,
    })
    await attachPlanBoardToSession(session.sessionId, planBoard.boardId, env)

    context.session.permissionMode = 'plan'
    context.session.permissionModeSource = 'slash_command'
    context.engine.setPermissionMode('plan')
    context.engine.setPlanFilePath('/tmp/project/old-plan.md')

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand(
      `/resume ${session.sessionId}`,
      context,
    )

    assert.equal(handled, true)
    board = await loadPlanBoardForSession('task-only-session', env)
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.doesNotMatch(text, /board title: Investigate auth edge cases/)
  assert.doesNotMatch(
    text,
    /board purpose: Gather the outstanding execution tasks before coding\./,
  )
  assert.doesNotMatch(text, /plan mode state:/)
  assert.doesNotMatch(text, /plan file:/)
  assert.equal(context.session.permissionMode, 'default')
  assert.equal(context.engine.getPlanFilePath(), undefined)
  assert.equal(board, null)
})

test('maybeHandleSlashCommand shows recent sessions when /resume has no session id', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-slash-resume-list-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      runtimeName: 'historic-runtime',
      provider: 'stub',
      model: 'resume-model',
      env,
    })
    await appendSessionMessages(
      session.sessionId,
      [createTextMessage('user', 'resume this later')],
      env,
    )

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const handled = await maybeHandleSlashCommand('/resume', createCommandContext())

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
  assert.match(text, /Use \/resume <session-id> to switch this interactive session to one of them\./)
})
