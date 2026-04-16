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
