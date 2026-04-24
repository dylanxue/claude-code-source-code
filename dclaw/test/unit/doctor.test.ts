import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctor } from '../../src/cli/doctor.js'

test('runDoctor prints effective retry and timeout diagnostics with sources', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dclaw-doctor-'))
  const originalEnv = process.env
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    await mkdir(join(cwd, '.dclaw'), { recursive: true })
    await writeFile(
      join(cwd, '.dclaw', 'config.json'),
      JSON.stringify({
        OPENAI_MODEL: 'kimi-k2.5',
        DCLAW_LLM_MAX_RETRIES: 7,
        DCLAW_ENABLE_STREAM_WATCHDOG: false,
        maxIterations: 9,
      }),
      'utf8',
    )

    process.env = {
      HOME: originalEnv.HOME,
      PATH: originalEnv.PATH,
      DCLAW_LLM_TIMEOUT_MS: '12345',
      DCLAW_STREAM_IDLE_TIMEOUT_MS: '45678',
      DCLAW_VISION_PROVIDER: 'openai',
      DCLAW_VISION_MODEL: 'gpt-4.1-mini',
    }
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runDoctor({
      mode: 'doctor',
      options: {
        cwd,
        provider: 'openai',
        stream: false,
        verbose: false,
        outputFormat: 'text',
      },
    })
  } finally {
    process.env = originalEnv
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(cwd, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /dclaw doctor/)
  assert.match(text, /max iterations\s+9 \(workspace_config\)/)
  assert.match(text, /max retries\s+7 \(workspace_config\)/)
  assert.match(text, /retry backoff\s+500ms exp, cap 32000ms, jitter 25%/)
  assert.match(text, /request timeout\s+12345ms \(env\)/)
  assert.match(text, /stream watchdog\s+disabled \(workspace_config\)/)
  assert.match(text, /stream idle timeout\s+45678ms \(env\)/)
  assert.match(text, /memory dir\s+.*\/projects\/.*\/memory/)
  assert.match(text, /memory entrypoint\s+.*\/MEMORY\.md/)
  assert.match(text, /memory entrypoint exists\s+no/)
  assert.match(text, /vision side query\s+configured/)
  assert.match(text, /vision provider\s+openai/)
  assert.match(text, /vision model\s+gpt-4\.1-mini/)
})
