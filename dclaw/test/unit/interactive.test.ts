import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInteractive } from '../../src/cli/interactive.js'
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
  assert.match(text, /dclaw interactive mode is ready\./)
  assert.match(text, /initial prompt: <none>/)
  assert.match(
    text,
    /Interactive REPL requires a TTY when no prompt is provided\./,
  )
})

test('runInteractive shows model canonicalization details in the startup header', async () => {
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
        verbose: false,
        outputFormat: 'text',
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /model: anthropic\/claude-opus-4\.7/)
  assert.match(text, /model canonicalized to: claude-opus-4-7/)
  assert.match(text, /catalog match: claude-opus-4-7/)
})
