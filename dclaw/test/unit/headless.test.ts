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
        verbose: false,
        outputFormat: 'sse',
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
  assert.equal(requestCount, 3)
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

test('runHeadless verbose SSE emits meta and streams tool calls in event order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-headless-'))
  const filePath = join(dir, 'example.txt')
  await writeFile(filePath, 'hello from verbose headless test', 'utf8')

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
        'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"reasoning","id":"rs_headless_verbose_1","summary":[{"type":"summary_text","text":"Inspect before using the tool."}],"encrypted_content":"enc_headless_verbose_1","status":"completed"},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Need to inspect first. "}]},{"type":"function_call","call_id":"call_headless_verbose_1","name":"Read","arguments":"{\\"file_path\\":\\"'
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
        verbose: true,
        outputFormat: 'sse',
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
  assert.equal(requestCount, 3)
  assert.deepEqual(
    events.map(event => event.event),
    [
      'response.meta',
      'assistant.delta',
      'assistant.reasoning',
      'assistant.content',
      'tool.use',
      'assistant.delta',
      'assistant.content',
      'response.complete',
    ],
  )

  assert.deepEqual(events[0]?.data, {
    mode: 'print',
    cwd: dir,
    provider: 'openai',
    providerSource: 'cli',
    model: 'gpt-4.1-mini',
    modelSource: 'cli',
    permissionMode: 'default',
    permissionModeSource: 'cli',
    stream: true,
    outputFormat: 'sse',
    sessionId: (events[0]?.data as { sessionId: string }).sessionId,
    queryTracePath: (events[0]?.data as { queryTracePath: string }).queryTracePath,
  })

  assert.deepEqual(events[2]?.data, {
    iteration: 1,
    messageId: (events[2]?.data as { messageId: string }).messageId,
    content: [
      {
        type: 'reasoning',
        id: 'rs_headless_verbose_1',
        summary: ['Inspect before using the tool.'],
        encryptedContent: 'enc_headless_verbose_1',
        status: 'completed',
      },
    ],
  })

  assert.deepEqual(events[3]?.data, {
    iteration: 1,
    messageId: (events[3]?.data as { messageId: string }).messageId,
    content: [{ type: 'text', text: 'Need to inspect first. ' }],
  })

  assert.deepEqual(events[4]?.data, {
    iteration: 1,
    id: 'call_headless_verbose_1',
    name: 'Read',
    input: {
      file_path: filePath,
    },
  })

  assert.deepEqual(events[6]?.data, {
    iteration: 2,
    messageId: (events[6]?.data as { messageId: string }).messageId,
    content: [{ type: 'text', text: 'Final answer' }],
  })

  const responseComplete = events.at(-1)?.data as {
    outputText: string
  }
  assert.equal(responseComplete.outputText, 'Final answer')
})

test('runHeadless verbose text streaming prints anthropic thinking before content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-headless-'))
  let requestCount = 0

  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/messages') {
      response.writeHead(404)
      response.end()
      return
    }

    requestCount += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking","thinking":"Need "}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"to inspect."}}\n\n',
    )
    response.write(
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"text","text":"Final "}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"answer"}}\n\n',
    )
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  const originalEnv = {
    DCLAW_ANTHROPIC_API_KEY: process.env.DCLAW_ANTHROPIC_API_KEY,
    DCLAW_ANTHROPIC_BASE_URL: process.env.DCLAW_ANTHROPIC_BASE_URL,
    DCLAW_ANTHROPIC_MODEL: process.env.DCLAW_ANTHROPIC_MODEL,
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    process.env.DCLAW_ANTHROPIC_API_KEY = 'test-key'
    process.env.DCLAW_ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`
    process.env.DCLAW_ANTHROPIC_MODEL = 'claude-test'

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runHeadless({
      mode: 'print',
      prompt: 'Please think first and answer.',
      options: {
        cwd: dir,
        provider: 'anthropic',
        model: 'claude-test',
        permissionMode: 'default',
        stream: true,
        verbose: true,
        outputFormat: 'text',
      },
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    process.env.DCLAW_ANTHROPIC_API_KEY = originalEnv.DCLAW_ANTHROPIC_API_KEY
    process.env.DCLAW_ANTHROPIC_BASE_URL = originalEnv.DCLAW_ANTHROPIC_BASE_URL
    process.env.DCLAW_ANTHROPIC_MODEL = originalEnv.DCLAW_ANTHROPIC_MODEL
    server.close()
    await once(server, 'close')
    await rm(dir, { recursive: true, force: true })
  }

  assert.equal(requestCount, 2)
  assert.match(output.join(''), /\[meta\] mode=print/)
  assert.match(output.join(''), new RegExp(`\\[meta\\] cwd=${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(output.join(''), /\[meta\] provider=anthropic/)
  assert.match(output.join(''), /\[meta\] model=claude-test/)
  assert.match(output.join(''), /\[meta\] permission_mode=default/)
  assert.match(output.join(''), /\[meta\] permission_mode_source=cli/)
  assert.match(output.join(''), /\[meta\] stream=true/)
  assert.match(output.join(''), /\[meta\] output_format=text/)
  assert.match(output.join(''), /\[meta\] session_id=/)
  assert.match(
    output.join(''),
    /\[reasoning:thinking\] Need to inspect\.\nFinal answer\n$/,
  )
})

test('runHeadless verbose SSE emits llm.error when streaming fails after partial reasoning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-headless-'))
  let requestCount = 0

  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/messages') {
      response.writeHead(404)
      response.end()
      return
    }

    requestCount += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking","thinking":"Need "}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"to inspect."}}\n\n',
    )
    response.destroy()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  const originalEnv = {
    DCLAW_ANTHROPIC_API_KEY: process.env.DCLAW_ANTHROPIC_API_KEY,
    DCLAW_ANTHROPIC_BASE_URL: process.env.DCLAW_ANTHROPIC_BASE_URL,
    DCLAW_ANTHROPIC_MODEL: process.env.DCLAW_ANTHROPIC_MODEL,
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const output: string[] = []

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    process.env.DCLAW_ANTHROPIC_API_KEY = 'test-key'
    process.env.DCLAW_ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`
    process.env.DCLAW_ANTHROPIC_MODEL = 'claude-test'

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await assert.rejects(
      () =>
        runHeadless({
          mode: 'print',
          prompt: 'Please think first and answer.',
          options: {
            cwd: dir,
            provider: 'anthropic',
            model: 'claude-test',
            permissionMode: 'default',
            stream: true,
            verbose: true,
            outputFormat: 'sse',
          },
        }),
      error =>
        error instanceof Error &&
        (error.message.includes('terminated') ||
          error.message.includes('fetch failed')),
    )
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    process.env.DCLAW_ANTHROPIC_API_KEY = originalEnv.DCLAW_ANTHROPIC_API_KEY
    process.env.DCLAW_ANTHROPIC_BASE_URL = originalEnv.DCLAW_ANTHROPIC_BASE_URL
    process.env.DCLAW_ANTHROPIC_MODEL = originalEnv.DCLAW_ANTHROPIC_MODEL
    server.close()
    await once(server, 'close')
    await rm(dir, { recursive: true, force: true })
  }

  const events = parseSseEvents(output.join(''))
  assert.equal(events[0]?.event, 'response.meta')
  assert.equal(events.at(-1)?.event, 'llm.error')

  const llmError = events.at(-1)?.data as {
    phase: string
    kind: string
    subtype: string
    streamedReasoningChars: number
    message: string
  }
  assert.match(llmError.phase, /^(before_response|during_stream)$/)
  assert.equal(llmError.kind, 'network')
  assert.equal(llmError.subtype, 'network_error')
  assert.ok(llmError.streamedReasoningChars >= 0)
  assert.match(llmError.message, /(terminated|fetch failed)/)
})
