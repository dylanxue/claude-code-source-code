import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createImageBlock,
  createMessage,
  createTextMessage,
  createToolResultMessage,
} from '../../src/types/message.js'
import type { PersistedToolResultOutput } from '../../src/core/toolResultBudget.js'
import {
  AnthropicLlmClient,
  resolveAnthropicConfig,
} from '../../src/llm/providers/anthropic.js'
import {
  getProviderErrorKind,
  getProviderErrorSubtype,
  RetryableHttpError,
} from '../../src/llm/providerUtils.js'

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
    defaultModelSource: 'env',
  })
})

test('AnthropicLlmClient formats persisted tool results as readable file references', async () => {
  let capturedBody: unknown

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      capturedBody = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
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

    await client.createMessage({
      model: 'claude-test',
      messages: [
        createToolResultMessage('user', 'tool_big', {
          type: 'persisted_tool_result',
          toolName: 'Huge',
          summary: 'Huge output persisted',
          filepath: '/tmp/dclaw/tool-results/result.txt',
          originalSizeChars: 123456,
          preview: 'first lines',
          truncated: true,
        } satisfies PersistedToolResultOutput),
      ],
    })

    const body = capturedBody as {
      messages?: Array<{
        content?: Array<{ type: string; content?: string }>
      }>
    }
    const toolResult = body.messages?.[0]?.content?.[0]
    assert.equal(toolResult?.type, 'tool_result')
    assert.match(toolResult?.content ?? '', /<persisted-output>/)
    assert.match(toolResult?.content ?? '', /Output too large \(123456 chars\)/)
    assert.match(toolResult?.content ?? '', /Full output saved to: \/tmp\/dclaw\/tool-results\/result.txt/)
    assert.match(toolResult?.content ?? '', /<\/persisted-output>/)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
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
            {
              type: 'thinking',
              thinking: 'Need to inspect the file first.',
              signature: 'sig_123',
            },
            { type: 'text', text: 'hello from anthropic' },
            {
              type: 'redacted_thinking',
              data: 'encrypted_thinking_blob',
            },
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
            type: 'thinking',
            thinking: 'Need to inspect before using the tool.',
            signature: 'sig_prev',
          },
          {
            type: 'redacted_thinking',
            data: 'encrypted_prev',
          },
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
      {
        type: 'thinking',
        thinking: 'Need to inspect the file first.',
        signature: 'sig_123',
      },
      { type: 'text', text: 'hello from anthropic' },
      {
        type: 'redacted_thinking',
        data: 'encrypted_thinking_blob',
      },
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
              type: 'thinking',
              thinking: 'Need to inspect before using the tool.',
              signature: 'sig_prev',
            },
            {
              type: 'redacted_thinking',
              data: 'encrypted_prev',
            },
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

test('AnthropicLlmClient maps user image blocks to Anthropic image content', async () => {
  let capturedBody: unknown

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      capturedBody = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
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

    await client.createMessage({
      model: 'claude-test',
      messages: [
        createMessage('user', [
          { type: 'text', text: 'What is in this image?' },
          createImageBlock('image/png', 'abc123'),
        ]),
      ],
    })

    assert.deepEqual(capturedBody, {
      model: 'claude-test',
      max_tokens: 32000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'abc123',
              },
            },
          ],
        },
      ],
    })
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
})

test('AnthropicLlmClient stringifies tool_result output even when structured image content exists', async () => {
  let capturedBody: unknown

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      capturedBody = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
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

    await client.createMessage({
      model: 'claude-test',
      messages: [
        createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_img_1',
            name: 'WebFetch',
            input: { url: 'https://example.com/cat.png', prompt: 'Describe it' },
          },
        ]),
        createToolResultMessage(
          'user',
          'tool_img_1',
          {
            contentKind: 'image',
            mediaType: 'image/png',
            result: 'Downloaded image content for analysis.',
          },
          {
            ok: true,
            output: {
              contentKind: 'image',
              mediaType: 'image/png',
              result: 'Downloaded image content for analysis.',
            },
          },
          [
            { type: 'text', text: 'Downloaded image content for analysis.' },
            createImageBlock('image/png', 'abc123'),
          ],
        ),
      ],
    })

    const toolResult = (
      capturedBody as {
        messages?: Array<{
          content?: Array<{ type: string; content?: string }>
        }>
      }
    ).messages?.[1]?.content?.[0]
    assert.equal(toolResult?.type, 'tool_result')
    assert.match(toolResult?.content ?? '', /contentKind/)
    assert.doesNotMatch(toolResult?.content ?? '', /abc123/)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
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
          type: 'authentication_error',
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

    await assert.rejects(async () => {
      await client.createMessage({
        messages: [createTextMessage('user', 'hello')],
      })
    }, error => {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /Anthropic request failed \(401 Unauthorized\): invalid x-api-key/,
      )
      assert.ok(error instanceof RetryableHttpError)
      assert.equal(getProviderErrorKind(error), 'auth')
      assert.equal(error.kind, 'auth')
      assert.equal(error.subtype, 'invalid_api_key')
      assert.equal(getProviderErrorSubtype(error), 'invalid_api_key')
      assert.equal(error.errorType, 'authentication_error')
      assert.equal(
        error.userMessage,
        'Anthropic rejected the configured API key. Check the credential and any account or project access settings.',
      )
      return true
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient classifies prompt-too-long responses distinctly', async () => {
  const server = createServer((_, response) => {
    response.writeHead(400, {
      'content-type': 'application/json',
    })
    response.end(
      JSON.stringify({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'prompt is too long: 137500 tokens > 135000 maximum',
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
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'claude-test',
      maxRetries: 0,
    })

    await assert.rejects(
      () =>
        client.createMessage({
          messages: [createTextMessage('user', 'hello')],
        }),
      error => {
        assert.ok(error instanceof RetryableHttpError)
        assert.equal(error.kind, 'bad_request')
        assert.equal(error.subtype, 'prompt_too_long')
        assert.equal(
          error.userMessage,
          'The request sent to Anthropic is too large. Reduce prompt or tool output size, or compact context before retrying.',
        )
        return true
      },
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient classifies tool protocol mismatches distinctly', async () => {
  const server = createServer((_, response) => {
    response.writeHead(400, {
      'content-type': 'application/json',
    })
    response.end(
      JSON.stringify({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            '`tool_use` ids were found without `tool_result` blocks immediately after',
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
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'claude-test',
      maxRetries: 0,
    })

    await assert.rejects(
      () =>
        client.createMessage({
          messages: [createTextMessage('user', 'hello')],
        }),
      error => {
        assert.ok(error instanceof RetryableHttpError)
        assert.equal(error.kind, 'bad_request')
        assert.equal(error.subtype, 'tool_use_mismatch')
        assert.equal(
          error.userMessage,
          'Anthropic rejected the tool call/result sequence. Ensure each tool_result matches a prior tool_use and appears in the expected order.',
        )
        return true
      },
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient retries 429s and prefers unified reset delay', async () => {
  const sleepCalls: number[] = []
  let attempts = 0

  const server = createServer((_, response) => {
    attempts += 1
    if (attempts === 1) {
      response.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '1',
        'anthropic-ratelimit-unified-reset': '3',
      })
      response.end(
        JSON.stringify({
          error: {
            message: 'rate limit reached',
          },
        }),
      )
      return
    }

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        content: [{ type: 'text', text: 'retried anthropic ok' }],
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
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'claude-test',
      nowImpl: () => 1000,
      sleepImpl: async ms => {
        sleepCalls.push(ms)
      },
    })

    const result = await client.createMessage({
      messages: [createTextMessage('user', 'hello')],
    })

    assert.equal(attempts, 2)
    assert.deepEqual(sleepCalls, [2000])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'retried anthropic ok' },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AnthropicLlmClient streams thinking deltas through reasoning callbacks', async () => {
  const deltas: Array<{ kind: string; text: string }> = []
  const textDeltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking","thinking":"Need "}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"to inspect."}}\n\n',
    )
    response.write(
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"text","text":"hello "}}\n\n',
    )
    response.write(
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"anthropic"}}\n\n',
    )
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
      defaultModel: 'claude-test',
    })

    const result = await client.createMessageStream?.(
      {
        messages: [createTextMessage('user', 'hello')],
      },
      {
        onReasoningDelta(delta) {
          deltas.push(delta)
        },
        onTextDelta(text) {
          textDeltas.push(text)
        },
      },
    )

    assert.ok(result)
    assert.deepEqual(deltas, [
      { kind: 'thinking', text: 'Need ' },
      { kind: 'thinking', text: 'to inspect.' },
    ])
    assert.deepEqual(textDeltas, ['hello ', 'anthropic'])
    assert.deepEqual(result.message.content, [
      {
        type: 'thinking',
        thinking: 'Need to inspect.',
      },
      {
        type: 'text',
        text: 'hello anthropic',
      },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})
