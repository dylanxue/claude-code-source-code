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
  OpenAiLlmClient,
  resolveOpenAiConfig,
} from '../../src/llm/providers/openai.js'

test('resolveOpenAiConfig reads dclaw env vars first', () => {
  const config = resolveOpenAiConfig({
    OPENAI_API_KEY: 'fallback-key',
    OPENAI_BASE_URL: 'https://fallback.example.com/v1/',
    OPENAI_MODEL: 'fallback-model',
    DCLAW_OPENAI_API_KEY: 'primary-key',
    DCLAW_OPENAI_BASE_URL: 'https://primary.example.com/v1/',
    DCLAW_OPENAI_MODEL: 'primary-model',
  })

  assert.deepEqual(config, {
    apiKey: 'primary-key',
    baseUrl: 'https://primary.example.com/v1',
    defaultModel: 'primary-model',
    apiStyle: 'chat-completions',
  })
})

test('OpenAiLlmClient supports Responses API requests', async () => {
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
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'hello from responses' }],
            },
            {
              type: 'function_call',
              call_id: 'call_123',
              name: 'Read',
              arguments: '{"file_path":"/tmp/example.txt"}',
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

    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiStyle: 'responses',
      env: {
        DCLAW_MODEL_LIMITS_JSON: JSON.stringify({
          providers: {
            openai: {
              'gpt-5': {
                maxOutputTokens: 777,
                maxOutputTokensUpperLimit: 1000,
                contextWindow: 400000,
              },
            },
          },
        }),
      },
    })

    const result = await client.createMessage({
      model: 'gpt-5',
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

    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello from responses' },
      {
        type: 'tool_use',
        id: 'call_123',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ])

    assert.deepEqual(capturedBody, {
      model: 'gpt-5',
      instructions: 'be concise',
      max_output_tokens: 777,
      stream: false,
      tools: [
        {
          type: 'function',
          name: 'Read',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
            required: ['file_path'],
            additionalProperties: false,
          },
        },
      ],
      input: [
        {
          role: 'user',
          content: 'Open the file',
        },
        {
          type: 'function_call',
          call_id: 'tool_123',
          name: 'Read',
          arguments: '{"file_path":"/tmp/example.txt"}',
        },
        {
          type: 'function_call_output',
          call_id: 'tool_123',
          output: '{\n  "ok": true,\n  "output": {\n    "file": {\n      "content": "hello"\n    }\n  }\n}',
        },
      ],
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient supports chat completions requests', async () => {
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
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'hello from chat completions',
                tool_calls: [
                  {
                    id: 'call_chat_1',
                    type: 'function',
                    function: {
                      name: 'Read',
                      arguments: '{"file_path":"/tmp/example.txt"}',
                    },
                  },
                ],
              },
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

    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiStyle: 'chat-completions',
      env: {
        DCLAW_MODEL_LIMITS_JSON: JSON.stringify({
          providers: {
            openai: {
              'kimi-k2.5': {
                maxOutputTokens: 2048,
                maxOutputTokensUpperLimit: 8192,
                contextWindow: 256000,
              },
            },
          },
        }),
      },
    })

    const result = await client.createMessage({
      model: 'kimi-k2.5',
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

    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello from chat completions' },
      {
        type: 'tool_use',
        id: 'call_chat_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ])

    assert.deepEqual(capturedBody, {
      model: 'kimi-k2.5',
      max_tokens: 2048,
      stream: false,
      tools: [
        {
          type: 'function',
          function: {
            name: 'Read',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
              },
              required: ['file_path'],
              additionalProperties: false,
            },
          },
        },
      ],
      messages: [
        {
          role: 'system',
          content: 'be concise',
        },
        {
          role: 'user',
          content: 'Open the file',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool_123',
              type: 'function',
              function: {
                name: 'Read',
                arguments: '{"file_path":"/tmp/example.txt"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool_123',
          content: '{\n  "ok": true,\n  "output": {\n    "file": {\n      "content": "hello"\n    }\n  }\n}',
        },
      ],
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient supports chat completions SSE streaming', async () => {
  const deltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
    )
    response.write(
      'data: {"choices":[{"delta":{"content":"stream","tool_calls":[{"index":0,"id":"call_stream_1","type":"function","function":{"name":"Read","arguments":"{\\"file_path\\":\\"/tmp/"}}]}}]}\n\n',
    )
    response.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"example.txt\\"}"}}]}}]}\n\n',
    )
    response.write('data: [DONE]\n\n')
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiStyle: 'chat-completions',
      defaultModel: 'kimi-k2.5',
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
    assert.deepEqual(deltas, ['hello ', 'stream'])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello stream' },
      {
        type: 'tool_use',
        id: 'call_stream_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient supports Responses API SSE streaming', async () => {
  const deltas: string[] = []
  let capturedBody: unknown

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      capturedBody = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello "}\n\n',
      )
      response.write(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"responses"}\n\n',
      )
      response.write(
        'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello responses"}]},{"type":"function_call","call_id":"call_stream_1","name":"Read","arguments":"{\\"file_path\\":\\"/tmp/example.txt\\"}"}]}}\n\n',
      )
      response.end()
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv4 server address')
    }

    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiStyle: 'responses',
      defaultModel: 'gpt-5',
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
    assert.deepEqual(deltas, ['hello ', 'responses'])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello responses' },
      {
        type: 'tool_use',
        id: 'call_stream_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ])
    assert.deepEqual(capturedBody, {
      model: 'gpt-5',
      input: [{ role: 'user', content: 'hello' }],
      max_output_tokens: 128000,
      stream: true,
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient rejects missing api key', async () => {
  const client = new OpenAiLlmClient({
    env: {},
    defaultModel: 'gpt-5',
  })

  await assert.rejects(
    () =>
      client.createMessage({
        messages: [createTextMessage('user', 'hello')],
      }),
    /OpenAI API key is required/,
  )
})

test('OpenAiLlmClient rejects missing model', async () => {
  const client = new OpenAiLlmClient({
    apiKey: 'test-key',
    env: {},
  })

  await assert.rejects(
    () =>
      client.createMessage({
        messages: [createTextMessage('user', 'hello')],
      }),
    /OpenAI model is required/,
  )
})

test('OpenAiLlmClient surfaces API errors', async () => {
  const server = createServer((_, response) => {
    response.writeHead(429, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        error: {
          message: 'rate limit exceeded',
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

    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'gpt-5',
    })

    await assert.rejects(
      () =>
        client.createMessage({
          messages: [createTextMessage('user', 'hello')],
        }),
      /OpenAI request failed \(429 Too Many Requests\): rate limit exceeded/,
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})
