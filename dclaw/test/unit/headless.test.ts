import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { runHeadless } from '../../src/cli/headless.js'

function parseSseEvents(output: string): Array<{
  event: string
  data: unknown
}> {
  return output
    .trim()
    .split('\n\n')
    .filter(chunk => chunk.length > 0)
    .map(chunk => {
      const lines = chunk.split('\n')
      const event = lines
        .find(line => line.startsWith('event: '))
        ?.slice('event: '.length)
      const dataLine = lines
        .find(line => line.startsWith('data: '))
        ?.slice('data: '.length)

      if (!event || !dataLine) {
        throw new Error(`Invalid SSE chunk: ${chunk}`)
      }

      return {
        event,
        data: JSON.parse(dataLine) as unknown,
      }
    })
}

test('runHeadless emits assistant message and reasoning SSE events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-headless-'))
  const filePath = join(dir, 'example.txt')
  await writeFile(filePath, 'hello from headless test', 'utf8')

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
    DCLAW_OPENAI_API_KEY: process.env.DCLAW_OPENAI_API_KEY,
    DCLAW_OPENAI_BASE_URL: process.env.DCLAW_OPENAI_BASE_URL,
    DCLAW_OPENAI_API_STYLE: process.env.DCLAW_OPENAI_API_STYLE,
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    process.env.DCLAW_OPENAI_API_KEY = 'test-key'
    process.env.DCLAW_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`
    process.env.DCLAW_OPENAI_API_STYLE = 'responses'

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runHeadless({
      mode: 'print',
      prompt: 'Please inspect the file and answer.',
      options: {
        cwd: dir,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        permissionMode: 'default',
        stream: true,
        outputFormat: 'sse',
        verbose: false,
      },
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    process.env.DCLAW_OPENAI_API_KEY = originalEnv.DCLAW_OPENAI_API_KEY
    process.env.DCLAW_OPENAI_BASE_URL = originalEnv.DCLAW_OPENAI_BASE_URL
    process.env.DCLAW_OPENAI_API_STYLE = originalEnv.DCLAW_OPENAI_API_STYLE
    server.close()
    await once(server, 'close')
    await rm(dir, { recursive: true, force: true })
  }

  const events = parseSseEvents(output.join(''))
  assert.equal(requestCount, 2)
  assert.deepEqual(
    events.map(event => event.event),
    [
      'assistant.delta',
      'assistant.message',
      'assistant.reasoning',
      'tool.use',
      'tool.result',
      'assistant.delta',
      'assistant.message',
      'response.complete',
    ],
  )

  const firstAssistantMessage = events[1]?.data as {
    content: Array<{ type: string }>
  }
  assert.deepEqual(
    firstAssistantMessage.content.map(block => block.type),
    ['reasoning', 'text', 'tool_use'],
  )

  assert.deepEqual(events[2]?.data, {
    iteration: 1,
    messageId: (events[1]?.data as { id: string }).id,
    content: [
      {
        type: 'reasoning',
        id: 'rs_headless_1',
        summary: ['Inspect before using the tool.'],
        encryptedContent: 'enc_headless_1',
        status: 'completed',
      },
    ],
  })

  const responseComplete = events.at(-1)?.data as {
    outputText: string
    assistantMessage: {
      content: Array<{ type: string }>
    }
  }
  assert.equal(responseComplete.outputText, 'Final answer')
  assert.deepEqual(
    responseComplete.assistantMessage.content.map(block => block.type),
    ['text'],
  )
})

test('runHeadless prints assistant debug lines in verbose text mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-headless-'))
  const filePath = join(dir, 'example.txt')
  await writeFile(filePath, 'hello from headless test', 'utf8')
  let requestCount = 0

  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404)
      response.end()
      return
    }

    requestCount += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    if (requestCount === 1) {
      response.end(
        JSON.stringify({
          output: [
            {
              type: 'reasoning',
              id: 'rs_text_1',
              summary: [
                {
                  type: 'summary_text',
                  text: 'Inspect before using the tool.',
                },
              ],
              encrypted_content: 'enc_text_1',
              status: 'completed',
            },
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'Need to inspect first.',
                },
              ],
            },
            {
              type: 'function_call',
              call_id: 'call_text_1',
              name: 'Read',
              arguments: JSON.stringify({
                file_path: filePath,
              }),
            },
          ],
        }),
      )
      return
    }

    response.end(
      JSON.stringify({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Final answer',
              },
            ],
          },
        ],
      }),
    )
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  const originalEnv = {
    DCLAW_OPENAI_API_KEY: process.env.DCLAW_OPENAI_API_KEY,
    DCLAW_OPENAI_BASE_URL: process.env.DCLAW_OPENAI_BASE_URL,
    DCLAW_OPENAI_API_STYLE: process.env.DCLAW_OPENAI_API_STYLE,
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    process.env.DCLAW_OPENAI_API_KEY = 'test-key'
    process.env.DCLAW_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`
    process.env.DCLAW_OPENAI_API_STYLE = 'responses'

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runHeadless({
      mode: 'print',
      prompt: 'Please inspect the file and answer.',
      options: {
        cwd: dir,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        permissionMode: 'default',
        stream: false,
        outputFormat: 'text',
        verbose: true,
      },
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    process.env.DCLAW_OPENAI_API_KEY = originalEnv.DCLAW_OPENAI_API_KEY
    process.env.DCLAW_OPENAI_BASE_URL = originalEnv.DCLAW_OPENAI_BASE_URL
    process.env.DCLAW_OPENAI_API_STYLE = originalEnv.DCLAW_OPENAI_API_STYLE
    server.close()
    await once(server, 'close')
    await rm(dir, { recursive: true, force: true })
  }

  assert.match(output.join(''), /Need to inspect first\./)
  assert.equal(requestCount, 2)
  assert.match(output.join(''), /Final answer/)
  assert.match(output.join(''), /\[reasoning\] Inspect before using the tool\./)
  assert.match(output.join(''), /\[tool use\] Read /)
})
