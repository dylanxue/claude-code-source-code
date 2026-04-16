import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMessage,
  createTextMessage,
  createToolResultMessage,
} from '../../src/types/message.js'
import {
  AnthropicLlmClient,
  resolveAnthropicConfig,
} from '../../src/llm/providers/anthropic.js'

test('resolveAnthropicConfig reads dclaw env vars first', () => {
  const config = resolveAnthropicConfig({
    ANTHROPIC_API_KEY: 'fallback-key',
    ANTHROPIC_BASE_URL: 'https://fallback.example.com/',
    ANTHROPIC_MODEL: 'fallback-model',
    DCLAW_ANTHROPIC_API_KEY: 'primary-key',
    DCLAW_ANTHROPIC_BASE_URL: 'https://primary.example.com/',
    DCLAW_ANTHROPIC_MODEL: 'primary-model',
  })

  assert.deepEqual(config, {
    provider: 'anthropic',
    apiKey: 'primary-key',
    baseUrl: 'https://primary.example.com',
    defaultModel: 'primary-model',
  })
})

test('AnthropicLlmClient sends messages and tools to the Anthropic API', async () => {
  let capturedHeaders: Record<string, string | string[] | undefined> | undefined
  let capturedBody: unknown

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      capturedHeaders = request.headers
      capturedBody = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          content: [
            { type: 'text', text: 'hello from anthropic' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'Read',
              input: { file_path: '/tmp/example.txt' },
            },
          ],
        }),
      )
    })
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
    })

    const result = await client.createMessage({
      model: 'claude-test',
      systemPrompt: 'be concise',
      tools: [
        {
          name: 'Read',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
            required: ['file_path'],
            additionalProperties: false,
          },
        },
      ],
      messages: [
        createTextMessage('user', 'Open the file'),
        createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'Read',
            input: { file_path: '/tmp/example.txt' },
          },
        ]),
        createToolResultMessage('user', 'tool_123', {
          ok: true,
          output: { file: { content: 'hello' } },
        }),
      ],
    })

    assert.equal(result.message.role, 'assistant')
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello from anthropic' },
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ])

    assert.equal(capturedHeaders?.['x-api-key'], 'test-key')
    assert.equal(capturedHeaders?.['anthropic-version'], '2023-06-01')
    assert.deepEqual(capturedBody, {
      model: 'claude-test',
      max_tokens: 32000,
      system: 'be concise',
      tools: [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
            required: ['file_path'],
            additionalProperties: false,
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Open the file' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool_123',
              name: 'Read',
              input: { file_path: '/tmp/example.txt' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_123',
              content: '{\n  "ok": true,\n  "output": {\n    "file": {\n      "content": "hello"\n    }\n  }\n}',
              is_error: false,
            },
          ],
        },
      ],
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient rejects missing api key', async () => {
  const client = new AnthropicLlmClient({
    env: {},
    defaultModel: 'claude-test',
  })

  await assert.rejects(
    () =>
      client.createMessage({
        messages: [createTextMessage('user', 'hello')],
      }),
    /Anthropic API key is required/,
  )
})

test('AnthropicLlmClient rejects missing model', async () => {
  const client = new AnthropicLlmClient({
    apiKey: 'test-key',
    env: {},
  })

  await assert.rejects(
    () =>
      client.createMessage({
        messages: [createTextMessage('user', 'hello')],
      }),
    /Anthropic model is required/,
  )
})

test('AnthropicLlmClient surfaces API errors', async () => {
  const server = createServer((_, response) => {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        error: {
          message: 'invalid x-api-key',
        },
      }),
    )
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    const client = new AnthropicLlmClient({
      apiKey: 'bad-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'claude-test',
    })

    await assert.rejects(
      () =>
        client.createMessage({
          messages: [createTextMessage('user', 'hello')],
        }),
      /Anthropic request failed \(401 Unauthorized\): invalid x-api-key/,
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})
