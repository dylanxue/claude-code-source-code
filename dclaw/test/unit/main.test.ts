import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dclawRoot = resolve(here, '../..')
const mainEntrypoint = resolve(dclawRoot, 'src/cli/main.ts')
const tsxLoader = resolve(dclawRoot, 'node_modules/tsx/dist/loader.mjs')

async function runCli(args: string[], cwd: string): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', tsxLoader, mainEntrypoint, ...args],
      {
        cwd,
        env: {
          ...process.env,
          OPENAI_API_KEY: '',
          DCLAW_OPENAI_API_KEY: '',
          ANTHROPIC_API_KEY: '',
          DCLAW_ANTHROPIC_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => {
      resolvePromise({
        stdout,
        stderr,
        exitCode: code,
      })
    })
  })
}

test('main emits response.error SSE for print+sse provider failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-main-'))

  try {
    const result = await runCli(
      [
        '--print',
        '--stream',
        '--output-format',
        'sse',
        '--provider',
        'openai',
        '--model',
        'gpt-5',
        'hello',
      ],
      dir,
    )

    assert.equal(result.exitCode, 1)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, /^event: response\.error\n/)
    assert.match(result.stdout, /"kind":"unknown"/)
    assert.match(result.stdout, /"message":"OpenAI API key is required\./)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('main emits stderr for non-sse provider failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-main-'))

  try {
    const result = await runCli(
      [
        '--print',
        '--provider',
        'anthropic',
        '--model',
        'claude-test',
        'hello',
      ],
      dir,
    )

    assert.equal(result.exitCode, 1)
    assert.equal(result.stdout, '')
    assert.match(
      result.stderr,
      /^CLI failed: Anthropic API key is required\. Set ANTHROPIC_API_KEY or DCLAW_ANTHROPIC_API_KEY, or configure ANTHROPIC_API_KEY in \.dclaw\/config\.json\.\nContext: phase=before_response iteration=1\n$/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
