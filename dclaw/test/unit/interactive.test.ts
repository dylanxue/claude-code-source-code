import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInteractive } from '../../src/cli/interactive.js'
import { getInteractiveRuntimeLabel } from '../../src/cli/interactiveContext.js'
import { getDclawConfigPath } from '../../src/session/paths.js'

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

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
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /:: DCLAW \(v0\.1\.0\)/)
  assert.match(text, /runtime:\s+stub\s+\/runtime to change/)
  assert.match(
    text,
    /Interactive REPL requires a TTY when no prompt is provided\./,
  )
})

test('runInteractive keeps the startup header concise after runtime resolution', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-canonical-'))
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-workspace-'))
  const env = { ...process.env, HOME: homeDir }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalEnv = process.env
  const output: string[] = []

  try {
    process.env = env
    await writeJson(getDclawConfigPath(env), {
      llm: {
        defaultRuntime: 'openrouter-claude',
        providers: {
          compat: {
            type: 'openai',
            apiKey: 'test-key',
            baseURL: 'https://example.test/v1',
            apiStyle: 'chat-completions',
          },
        },
        runtimes: {
          'openrouter-claude': {
            primary: {
              providerRef: 'compat',
              model: 'anthropic/claude-opus-4.7',
            },
          },
        },
      },
    })
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runInteractive({
      mode: 'interactive',
      options: {
        cwd: workspaceDir,
        stream: false,
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /runtime:\s+openrouter-claude\s+\/runtime to change/)
  assert.match(text, /permission mode: default/)
  assert.doesNotMatch(text, /\[meta\]/)
})

test('getInteractiveRuntimeLabel prefers the resolved runtime name', () => {
  assert.equal(
    getInteractiveRuntimeLabel({
      runtime: {
        runtimeName: 'gpt-5.4-mini',
      } as Parameters<typeof getInteractiveRuntimeLabel>[0]['runtime'],
      replSession: {
        sessionId: 'session-123',
        mode: 'interactive',
        runtimeName: 'legacy-runtime',
        provider: 'openai',
        providerSource: 'user_config',
        model: 'gpt-5.4',
        modelSource: 'user_config',
        permissionMode: 'default',
        permissionModeSource: 'default',
      },
    }),
    'gpt-5.4-mini',
  )
})

test('runInteractive routes to the TUI runner when requested', async () => {
  let selected: 'legacy' | 'tui' | undefined

  await runInteractive(
    {
      mode: 'interactive',
      options: {
        cwd: '/tmp/project',
        stream: false,
        interactiveUi: 'tui',
      },
    },
    {
      async runLegacyRepl() {
        selected = 'legacy'
      },
      async runTui() {
        selected = 'tui'
      },
    },
  )

  assert.equal(selected, 'tui')
})

test('runInteractive keeps the legacy REPL as the default path during phase 0', async () => {
  let selected: 'legacy' | 'tui' | undefined

  await runInteractive(
    {
      mode: 'interactive',
      options: {
        cwd: '/tmp/project',
        stream: false,
      },
    },
    {
      async runLegacyRepl() {
        selected = 'legacy'
      },
      async runTui() {
        selected = 'tui'
      },
    },
  )

  assert.equal(selected, 'legacy')
})
