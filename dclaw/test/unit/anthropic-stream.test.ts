import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextMessage } from '../../src/types/message.js'
import { AnthropicLlmClient } from '../../src/llm/providers/anthropic.js'

test('AnthropicLlmClient supports SSE streaming', async () => {
  const deltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"text","text":""}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"hello "}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"anthropic"}}\n\n',
    )
    response.write(
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"tool_stream_1","name":"Read","input":{}}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"/tmp/example.txt\\"}"}}\n\n',
    )
    response.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    const client = new AnthropicLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'claude-sonnet-4-6',
    })

    const result = await client.createMessageStream?.(
      {
        messages: [createTextMessage('user', 'hello')],
      },
      {
        onTextDelta(text) {
          deltas.push(text)
        },
      },
    )

    assert.ok(result)
    assert.deepEqual(deltas, ['hello ', 'anthropic'])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello anthropic' },
      {
        type: 'tool_use',
        id: 'tool_stream_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient skips sparse SSE block indexes', async () => {
  const deltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"text","text":""}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"sparse ok"}}\n\n',
    )
    response.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    const client = new AnthropicLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'claude-sonnet-4-6',
    })

    const result = await client.createMessageStream?.(
      {
        messages: [createTextMessage('user', 'hello')],
      },
      {
        onTextDelta(text) {
          deltas.push(text)
        },
      },
    )

    assert.ok(result)
    assert.deepEqual(deltas, ['sparse ok'])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'sparse ok' },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient preserves streaming thinking blocks', async () => {
  const deltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"Need to inspect first."}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"signature_delta","signature":"sig_stream_1"}}\n\n',
    )
    response.write(
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"text","text":""}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"done"}}\n\n',
    )
    response.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    const client = new AnthropicLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'claude-sonnet-4-6',
    })

    const result = await client.createMessageStream?.(
      {
        messages: [createTextMessage('user', 'hello')],
      },
      {
        onTextDelta(text) {
          deltas.push(text)
        },
      },
    )

    assert.ok(result)
    assert.deepEqual(deltas, ['done'])
    assert.deepEqual(result.message.content, [
      {
        type: 'thinking',
        thinking: 'Need to inspect first.',
        signature: 'sig_stream_1',
      },
      {
        type: 'text',
        text: 'done',
      },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient falls back to non-streaming when the stream idles before first event', async () => {
  let attempts = 0

  const client = new AnthropicLlmClient({
    apiKey: 'test-key',
    defaultModel: 'claude-sonnet-4-6',
    requestTimeoutMs: 1000,
    streamWatchdogEnabled: true,
    streamIdleTimeoutMs: 20,
    fetchImpl: async (_input, init) => {
      attempts += 1
      const bodyText =
        typeof init?.body === 'string' ? init.body : String(init?.body ?? '')
      const body = JSON.parse(bodyText) as { stream?: boolean }

      if (body.stream) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start() {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        )
      }

      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'fallback anthropic ok' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  })

  const result =
    (await client.createMessageStream?.(
      {
        messages: [createTextMessage('user', 'hello')],
      },
      {},
    )) ?? null

  assert.ok(result)
  assert.equal(attempts, 2)
  assert.deepEqual(result.message.content, [
    { type: 'text', text: 'fallback anthropic ok' },
  ])
})
