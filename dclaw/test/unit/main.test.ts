import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dclawRoot = resolve(here, '../..')
const mainEntrypoint = resolve(dclawRoot, 'src/cli/main.ts')
const binEntrypoint = resolve(dclawRoot, 'bin/dclaw.js')
const tsxLoader = resolve(dclawRoot, 'node_modules/tsx/dist/loader.mjs')

async function writeUserConfig(
  dclawHome: string,
  config: Record<string, unknown>,
): Promise<void> {
  await mkdir(dclawHome, { recursive: true })
  await writeFile(
    join(dclawHome, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf8',
  )
}

async function runCli(args: string[], cwd: string): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const dclawHome = join(cwd, '.dclaw-home-test')

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', tsxLoader, mainEntrypoint, ...args],
      {
        cwd,
        env: {
          ...process.env,
          DCLAW_HOME: dclawHome,
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

async function runBin(args: string[], cwd: string): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const dclawHome = join(cwd, '.dclaw-home-test')

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [binEntrypoint, ...args], {
      cwd,
      env: {
        ...process.env,
        DCLAW_HOME: dclawHome,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

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
  const dclawHome = join(dir, '.dclaw-home-test')

  try {
    await writeUserConfig(dclawHome, {
      llm: {
        defaultRuntime: 'openai-missing-key',
        providers: {
          'openai-missing-key': {
            type: 'openai',
          },
        },
        runtimes: {
          'openai-missing-key': {
            primary: {
              providerRef: 'openai-missing-key',
              model: 'gpt-5',
            },
          },
        },
      },
    })

    const result = await runCli(
      [
        '--print',
        '--stream',
        '--output-format',
        'sse',
        '--runtime',
        'openai-missing-key',
        'hello',
      ],
      dir,
    )

    assert.equal(result.exitCode, 1)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, /^event: response\.error\n/)
    assert.match(result.stdout, /"kind":"unknown"/)
    assert.match(
      result.stdout,
      /"message":"OpenAI API key is required\. Configure llm\.providers\.<name>\.apiKey in ~\/\.dclaw\/config\.json\./,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('main emits stderr for non-sse provider failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-main-'))
  const dclawHome = join(dir, '.dclaw-home-test')

  try {
    await writeUserConfig(dclawHome, {
      llm: {
        defaultRuntime: 'anthropic-missing-key',
        providers: {
          'anthropic-missing-key': {
            type: 'anthropic',
          },
        },
        runtimes: {
          'anthropic-missing-key': {
            primary: {
              providerRef: 'anthropic-missing-key',
              model: 'claude-test',
            },
          },
        },
      },
    })

    const result = await runCli(
      [
        '--print',
        '--runtime',
        'anthropic-missing-key',
        'hello',
      ],
      dir,
    )

    assert.equal(result.exitCode, 1)
    assert.equal(result.stdout, '')
    assert.match(
      result.stderr,
      /^CLI failed: Anthropic API key is required\. Configure llm\.providers\.<name>\.apiKey in ~\/\.dclaw\/config\.json\.\nContext: phase=before_response iteration=1\n$/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('bin wrapper launches dclaw from outside the repo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-bin-'))

  try {
    const result = await runBin(['--version'], dir)

    assert.equal(result.exitCode, 0)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, /^0\.1\.0\n$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
