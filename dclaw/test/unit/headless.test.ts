import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runHeadless } from '../../src/cli/headless.js'

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

test('runHeadless streams assistant text and tool summaries in text mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-headless-'))
  const filePath = join(dir, 'example.txt')
  await writeFile(filePath, 'example', 'utf8')

  let requestCount = 0
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404)
      response.end()
      return
    }

    requestCount += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' })

    if (requestCount === 1) {
      response.write(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Need to inspect first. "}\n\n',
      )
      response.write(
        'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"reasoning","id":"rs_headless_1","summary":[{"type":"summary_text","text":"Inspect before using the tool."}],"encrypted_content":"enc_headless_1","status":"completed"},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Need to inspect first. "}]},{"type":"function_call","call_id":"call_headless_1","name":"Read","arguments":"{\\"file_path\\":\\"'
          + filePath.replace(/\\/g, '\\\\')
          + '\\"}"}]}}\n\n',
      )
      response.end()
      return
    }

    response.write(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Final answer"}\n\n',
    )
    response.write(
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Final answer"}]}]}}\n\n',
    )
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  const originalEnv = {
    DCLAW_HOME: process.env.DCLAW_HOME,
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    process.env.DCLAW_HOME = join(dir, '.dclaw-home')
    await writeUserConfig(process.env.DCLAW_HOME, {
      llm: {
        defaultRuntime: 'default',
        providers: {
          'openai-test': {
            type: 'openai',
            apiKey: 'test-key',
            baseURL: `http://127.0.0.1:${address.port}/v1`,
            apiStyle: 'responses',
          },
        },
        runtimes: {
          default: {
            primary: {
              providerRef: 'openai-test',
              model: 'gpt-4.1-mini',
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

    await runHeadless({
      mode: 'exec',
      prompt: 'Please inspect the file and answer.',
      options: {
        cwd: dir,
        runtime: 'default',
        permissionMode: 'default',
        stream: true,
      },
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    process.env.DCLAW_HOME = originalEnv.DCLAW_HOME
    server.close()
    await once(server, 'close')
    await rm(dir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.equal(requestCount, 3)
  assert.match(text, /Need to inspect first\./)
  assert.match(text, /Read .*example\.txt .*example/)
  assert.match(text, /Final answer\n$/)
})

test('runHeadless prints the final assistant text once in non-stream mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-headless-final-'))

  const originalEnv = {
    DCLAW_HOME: process.env.DCLAW_HOME,
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    process.env.DCLAW_HOME = join(dir, '.dclaw-home')
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runHeadless({
      mode: 'exec',
      prompt: 'Just answer directly.',
      options: {
        cwd: dir,
        stream: false,
      },
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    process.env.DCLAW_HOME = originalEnv.DCLAW_HOME
    await rm(dir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(text, /^dclaw stub response\nmodel: default\n/)
  assert.equal(text.match(/^dclaw stub response$/gm)?.length ?? 0, 1)
})
