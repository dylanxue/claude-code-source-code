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

test('runInteractive reports that a TTY is required for the TUI', async () => {
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
  assert.match(text, /Interactive TUI requires a TTY\./)
})

test('runInteractive checks TTY before resolving runtime context', async () => {
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
  assert.match(text, /Interactive TUI requires a TTY\./)
  assert.doesNotMatch(text, /openrouter-claude/)
})

test('getInteractiveRuntimeLabel prefers the resolved runtime name', () => {
  assert.equal(
    getInteractiveRuntimeLabel({
      runtime: {
        runtimeName: 'gpt-5.4-mini',
      } as Parameters<typeof getInteractiveRuntimeLabel>[0]['runtime'],
      interactiveSession: {
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

test('runInteractive routes to the TUI runner by default', async () => {
  let selected: 'tui' | undefined

  await runInteractive(
    {
      mode: 'interactive',
      options: {
        cwd: '/tmp/project',
        stream: false,
      },
    },
    {
      async runTui() {
        selected = 'tui'
      },
    },
  )

  assert.equal(selected, 'tui')
})
