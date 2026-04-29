import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createImageBlock,
  createMessage,
  createPdfBlock,
  createTextMessage,
  createToolResultMessage,
} from '../../src/types/message.js'
import type { PersistedToolResultOutput } from '../../src/core/toolResultBudget.js'
import { OpenAiLlmClient } from '../../src/llm/providers/openai.js'
import { resolveProviderConfig } from '../../src/llm/providerConfig.js'
import {
  getRetryDelayMs,
  getProviderErrorKind,
  getProviderErrorSubtype,
  RetryableHttpError,
} from '../../src/llm/providerUtils.js'

test('resolveProviderConfig builds openai provider config from a typed profile', () => {
  const config = resolveProviderConfig({
    type: 'openai',
    apiKey: 'primary-key',
    baseURL: 'https://primary.example.com/v1/',
    proxyURL: 'http://proxy.example:8080',
    apiStyle: 'chat-completions',
  })

  assert.deepEqual(config, {
    provider: 'openai',
    apiKey: 'primary-key',
    baseUrl: 'https://primary.example.com/v1',
    proxyUrl: 'http://proxy.example:8080',
    apiStyle: 'chat-completions',
    defaultTextVerbosity: undefined,
    defaultReasoningEffort: undefined,
    defaultStore: undefined,
  })
})

test('resolveProviderConfig keeps openai request defaults from typed config', () => {
  const config = resolveProviderConfig({
    type: 'openai',
    requestDefaults: {
      verbosity: 'medium',
      reasoningEffort: 'high',
      store: false,
    },
  })

  assert.deepEqual(config, {
    provider: 'openai',
    apiKey: undefined,
    baseUrl: 'https://api.openai.com/v1',
    apiStyle: 'responses',
    defaultTextVerbosity: 'medium',
    defaultReasoningEffort: 'high',
    defaultStore: false,
  })
})

test('resolveProviderConfig accepts codex responses api style', () => {
  const config = resolveProviderConfig({
    type: 'openai',
    apiStyle: 'codex-responses',
  })

  assert.equal(config.provider, 'openai')
  assert.equal(config.apiStyle, 'codex-responses')
})

test('OpenAiLlmClient formats persisted tool results as readable file references', async () => {
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
                content: 'ok',
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
    })

    await client.createMessage({
      model: 'gpt-4.1',
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
      messages?: Array<{ role: string; content?: string }>
    }
    assert.equal(body.messages?.[0]?.role, 'tool')
    assert.match(body.messages?.[0]?.content ?? '', /<persisted-output>/)
    assert.match(body.messages?.[0]?.content ?? '', /Output too large \(123456 chars\)/)
    assert.match(body.messages?.[0]?.content ?? '', /Full output saved to: \/tmp\/dclaw\/tool-results\/result.txt/)
    assert.match(body.messages?.[0]?.content ?? '', /Preview \(first 11 chars\):/)
    assert.match(body.messages?.[0]?.content ?? '', /<\/persisted-output>/)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
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
              type: 'reasoning',
              id: 'rs_123',
              summary: [{ type: 'summary_text', text: 'Need to inspect the file first.' }],
              encrypted_content: 'enc_123',
              status: 'completed',
            },
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'hello from responses',
                  annotations: [
                    {
                      type: 'url_citation',
                      start_index: 0,
                      end_index: 5,
                      title: 'Example',
                      url: 'https://example.com',
                    },
                  ],
                },
              ],
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
      modelCatalogOverrides: {
        'gpt-5': {
          maxOutputTokens: 777,
          maxOutputTokensUpperLimit: 1000,
          contextWindow: 400000,
        },
      },
    })

    const result = await client.createMessage({
      model: 'gpt-5',
      systemPrompt: 'be concise',
      providerOptions: {
        openai: {
          verbosity: 'high',
          reasoningEffort: 'minimal',
          previousResponseId: 'resp_prev_123',
          store: true,
          parallelToolCalls: false,
          maxToolCalls: 1,
          include: ['output_text.annotations'],
          truncation: 'auto',
          metadata: {
            source: 'unit-test',
          },
          textFormat: {
            type: 'json_schema',
            name: 'answer',
            schema: {
              type: 'object',
              properties: {
                result: { type: 'string' },
              },
              required: ['result'],
              additionalProperties: false,
            },
          },
        },
      },
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
            type: 'reasoning',
            id: 'rs_prev',
            summary: ['First inspect the file.'],
            encryptedContent: 'enc_prev',
            status: 'completed',
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

    assert.deepEqual(result.message.content, [
      {
        type: 'reasoning',
        id: 'rs_123',
        summary: ['Need to inspect the file first.'],
        encryptedContent: 'enc_123',
        status: 'completed',
      },
      {
        type: 'text',
        text: 'hello from responses',
        annotations: [
          {
            type: 'url_citation',
            startIndex: 0,
            endIndex: 5,
            title: 'Example',
            url: 'https://example.com',
            raw: {
              type: 'url_citation',
              start_index: 0,
              end_index: 5,
              title: 'Example',
              url: 'https://example.com',
            },
          },
        ],
      },
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
      previous_response_id: 'resp_prev_123',
      store: true,
      parallel_tool_calls: false,
      max_tool_calls: 1,
      include: ['output_text.annotations'],
      truncation: 'auto',
      metadata: {
        source: 'unit-test',
      },
      text: {
        verbosity: 'high',
        format: {
          type: 'json_schema',
          name: 'answer',
          schema: {
            type: 'object',
            properties: {
              result: { type: 'string' },
            },
            required: ['result'],
            additionalProperties: false,
          },
        },
      },
      reasoning: {
        effort: 'minimal',
      },
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
          type: 'reasoning',
          id: 'rs_prev',
          summary: [
            {
              type: 'summary_text',
              text: 'First inspect the file.',
            },
          ],
          encrypted_content: 'enc_prev',
          status: 'completed',
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

test('OpenAiLlmClient accepts Responses SSE bodies from non-streaming requests', async () => {
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
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"compact "}\n\n',
      )
      response.write(
        'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"compact summary"}]}]}}\n\n',
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

    const result = await client.createMessage({
      messages: [createTextMessage('user', 'summarize')],
    })

    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'compact summary' },
    ])
    assert.equal((capturedBody as { stream?: boolean }).stream, false)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient uses Codex Responses request shape for Codex backends', async () => {
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
              content: [{ type: 'output_text', text: 'hello from codex' }],
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
      apiStyle: 'codex-responses',
      modelCatalogOverrides: {
        'gpt-5.4': {
          maxOutputTokens: 777,
          maxOutputTokensUpperLimit: 1000,
          contextWindow: 400000,
        },
      },
    })

    await client.createMessage({
      model: 'gpt-5.4',
      providerOptions: {
        openai: {
          store: true,
        },
      },
      messages: [
        createMessage('assistant', [
          {
            type: 'reasoning',
            id: 'rs_previous',
            summary: ['Previous reasoning.'],
            encryptedContent: 'enc_previous',
            status: 'completed',
          },
        ]),
        createTextMessage('user', 'hello'),
      ],
    })

    assert.deepEqual(capturedBody, {
      model: 'gpt-5.4',
      input: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Previous reasoning.' }],
          encrypted_content: 'enc_previous',
          status: 'completed',
        },
        { role: 'user', content: 'hello' },
      ],
      store: false,
      stream: false,
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient maps user image blocks to Responses input content', async () => {
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
              content: [{ type: 'output_text', text: 'ok' }],
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
    })

    await client.createMessage({
      model: 'gpt-4.1-mini',
      messages: [
        createMessage('user', [
          { type: 'text', text: 'What is in this image?' },
          createImageBlock('image/png', 'abc123'),
        ]),
      ],
    })

    assert.deepEqual(
      (capturedBody as { input?: unknown[] }).input,
      [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is in this image?' },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,abc123',
            },
          ],
        },
      ],
    )
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
})

test('OpenAiLlmClient maps user image blocks to chat-completions content parts', async () => {
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
                content: 'ok',
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
    })

    await client.createMessage({
      model: 'gpt-4.1-mini',
      messages: [
        createMessage('user', [
          { type: 'text', text: 'What is in this image?' },
          createImageBlock('image/png', 'abc123'),
        ]),
      ],
    })

    assert.deepEqual(
      (capturedBody as { messages?: unknown[] }).messages,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,abc123',
              },
            },
          ],
        },
      ],
    )
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
})

test('OpenAiLlmClient maps user PDF blocks to Responses input files', async () => {
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
      response.end(JSON.stringify({
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      }))
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
    })
    await client.createMessage({
      model: 'gpt-5',
      messages: [
        createMessage('user', [
          { type: 'text', text: 'Summarize this PDF' },
          createPdfBlock('JVBERi0xLjc=', 'report.pdf'),
        ]),
      ],
    })

    assert.deepEqual(
      (capturedBody as { input?: unknown[] }).input,
      [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Summarize this PDF' },
            {
              type: 'input_file',
              filename: 'report.pdf',
              file_data: 'data:application/pdf;base64,JVBERi0xLjc=',
            },
          ],
        },
      ],
    )
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
})

test('OpenAiLlmClient maps user PDF blocks to chat-completions file parts', async () => {
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
      response.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }))
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
    })
    await client.createMessage({
      model: 'gpt-5',
      messages: [
        createMessage('user', [
          { type: 'text', text: 'Summarize this PDF' },
          createPdfBlock('JVBERi0xLjc=', 'report.pdf'),
        ]),
      ],
    })

    assert.deepEqual(
      (capturedBody as { messages?: unknown[] }).messages,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Summarize this PDF' },
            {
              type: 'file',
              file: {
                filename: 'report.pdf',
                file_data: 'data:application/pdf;base64,JVBERi0xLjc=',
              },
            },
          ],
        },
      ],
    )
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
})

test('OpenAiLlmClient stringifies tool_result output even when structured image content exists', async () => {
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
                content: 'ok',
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
    })

    await client.createMessage({
      model: 'gpt-4.1-mini',
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

    assert.equal(
      (capturedBody as { messages?: Array<{ role: string; content: string }> })
        .messages?.[1]?.content,
      '{\n  "contentKind": "image",\n  "mediaType": "image/png",\n  "result": "Downloaded image content for analysis."\n}',
    )
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
})

test('OpenAiLlmClient preserves Responses API output text annotations in streaming mode', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"hello annotated"}\n\n',
    )
    response.write(
      'event: response.output_text.annotation.added\ndata: {"type":"response.output_text.annotation.added","output_index":0,"annotation":{"type":"url_citation","start_index":0,"end_index":5,"title":"Example","url":"https://example.com"}}\n\n',
    )
    response.write(
      'event: response.done\ndata: {"type":"response.done","response":{"output":[]}}\n\n',
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
      apiStyle: 'responses',
      defaultModel: 'gpt-5',
    })

    const result = await client.createMessageStream?.(
      {
        messages: [createTextMessage('user', 'hello')],
      },
      {},
    )

    assert.ok(result)
    assert.deepEqual(result.message.content, [
      {
        type: 'text',
        text: 'hello annotated',
        annotations: [
          {
            type: 'url_citation',
            startIndex: 0,
            endIndex: 5,
            title: 'Example',
            url: 'https://example.com',
            raw: {
              type: 'url_citation',
              start_index: 0,
              end_index: 5,
              title: 'Example',
              url: 'https://example.com',
            },
          },
        ],
      },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient supports Responses API message item streaming without output_text deltas', async () => {
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
        'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello from message item"}]}}\n\n',
      )
      response.write(
        'event: response.done\ndata: {"type":"response.done","response":{"output":[]}}\n\n',
      )
      response.write('data: [DONE]\n\n')
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
      defaultTextVerbosity: 'low',
      defaultReasoningEffort: 'medium',
      defaultStore: false,
    })

    const result = await client.createMessageStream?.(
      {
        messages: [createTextMessage('user', 'hello')],
      },
      {},
    )

    assert.ok(result)
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello from message item' },
    ])
    assert.deepEqual(capturedBody, {
      model: 'gpt-5',
      input: [{ role: 'user', content: 'hello' }],
      max_output_tokens: 128000,
      text: {
        verbosity: 'low',
      },
      reasoning: {
        effort: 'medium',
      },
      store: false,
      stream: true,
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient supports Responses API content_part streaming events', async () => {
  const deltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: response.content_part.added\ndata: {"type":"response.content_part.added","output_index":0,"part":{"type":"output_text","text":"hello "}}\n\n',
    )
    response.write(
      'event: response.content_part.done\ndata: {"type":"response.content_part.done","output_index":0,"part":{"type":"output_text","text":"hello content part"}}\n\n',
    )
    response.write(
      'event: response.done\ndata: {"type":"response.done","response":{"output":[]}}\n\n',
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
    assert.deepEqual(deltas, ['hello '])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'hello content part' },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient does not duplicate mixed Responses API text streaming events', async () => {
  const deltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: response.content_part.added\ndata: {"type":"response.content_part.added","output_index":0,"part":{"type":"output_text","text":"hello "}}\n\n',
    )
    response.write(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"hello "}\n\n',
    )
    response.write(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"responses"}\n\n',
    )
    response.write(
      'event: response.content_part.done\ndata: {"type":"response.content_part.done","output_index":0,"part":{"type":"output_text","text":"hello responses"}}\n\n',
    )
    response.write(
      'event: response.output_text.done\ndata: {"type":"response.output_text.done","output_index":0,"text":"hello responses"}\n\n',
    )
    response.write(
      'event: response.done\ndata: {"type":"response.done","response":{"output":[]}}\n\n',
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
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient supports Responses API refusal streaming events', async () => {
  const deltas: string[] = []

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'event: response.refusal.delta\ndata: {"type":"response.refusal.delta","output_index":0,"delta":"Cannot "}\n\n',
    )
    response.write(
      'event: response.refusal.done\ndata: {"type":"response.refusal.done","output_index":0,"refusal":"Cannot help with that."}\n\n',
    )
    response.write(
      'event: response.done\ndata: {"type":"response.done","response":{"output":[]}}\n\n',
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
    assert.deepEqual(deltas, ['Cannot '])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'Cannot help with that.' },
    ])
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
                reasoning_content: 'Need to inspect before using the tool.',
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
      defaultStore: false,
      modelCatalogOverrides: {
        'kimi-k2.5': {
          maxOutputTokens: 2048,
          maxOutputTokensUpperLimit: 8192,
          contextWindow: 256000,
        },
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
      {
        type: 'thinking',
        thinking: 'Need to inspect before using the tool.',
      },
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
      store: false,
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
      'data: {"choices":[{"delta":{"reasoning_content":"Need to "}}]}\n\n',
    )
    response.write(
      'data: {"choices":[{"delta":{"reasoning_content":"inspect. ","content":"hello "}}]}\n\n',
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
      { type: 'thinking', thinking: 'Need to inspect. ' },
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

test('OpenAiLlmClient falls back to non-streaming when the stream ends before first event', async () => {
  const deltas: string[] = []
  let streamAttempts = 0
  let nonStreamingAttempts = 0

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = JSON.parse(body) as { stream?: boolean }
      if (parsed.stream) {
        streamAttempts += 1
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end()
        return
      }

      nonStreamingAttempts += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'fallback openai ok' }],
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
    assert.equal(streamAttempts, 1)
    assert.equal(nonStreamingAttempts, 1)
    assert.deepEqual(deltas, [])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'fallback openai ok' },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient preserves incremental Responses API reasoning and tool-call SSE events', async () => {
  const deltas: string[] = []
  let capturedBody: unknown

  const server = createServer((request, response) => {
    const writeEvent = (eventName: string, payload: unknown) => {
      response.write(`event: ${eventName}\n`)
      response.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      capturedBody = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      writeEvent('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'reasoning',
          id: 'rs_stream_1',
          summary: [],
          status: 'in_progress',
        },
      })
      writeEvent('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        output_index: 0,
        item_id: 'rs_stream_1',
        delta: 'Need ',
      })
      writeEvent('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        output_index: 0,
        item_id: 'rs_stream_1',
        delta: 'to inspect.',
      })
      writeEvent('response.reasoning_summary_text.done', {
        type: 'response.reasoning_summary_text.done',
        output_index: 0,
        item_id: 'rs_stream_1',
        text: 'Need to inspect.',
      })
      writeEvent('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: 1,
        item: {
          type: 'function_call',
          call_id: 'call_stream_1',
          name: 'Read',
          arguments: '',
        },
      })
      writeEvent('response.function_call_arguments.delta', {
        type: 'response.function_call_arguments.delta',
        output_index: 1,
        item_id: 'call_stream_1',
        delta: '{"file_path":"/tmp/',
      })
      writeEvent('response.function_call_arguments.delta', {
        type: 'response.function_call_arguments.delta',
        output_index: 1,
        item_id: 'call_stream_1',
        delta: 'example.txt"}',
      })
      writeEvent('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        output_index: 1,
        item_id: 'call_stream_1',
        arguments: '{"file_path":"/tmp/example.txt"}',
      })
      writeEvent('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: 1,
        item: {
          type: 'function_call',
          call_id: 'call_stream_1',
          name: 'Read',
          arguments: '{"file_path":"/tmp/example.txt"}',
        },
      })
      writeEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        output_index: 2,
        delta: 'hello ',
      })
      writeEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        output_index: 2,
        delta: 'responses',
      })
      writeEvent('response.output_text.done', {
        type: 'response.output_text.done',
        output_index: 2,
        text: 'hello responses',
      })
      writeEvent('response.done', {
        type: 'response.done',
        response: { output: [] },
      })
      response.write('data: [DONE]\n\n')
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
      {
        type: 'reasoning',
        id: 'rs_stream_1',
        summary: ['Need to inspect.'],
        status: 'in_progress',
      },
      {
        type: 'tool_use',
        id: 'call_stream_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
      { type: 'text', text: 'hello responses' },
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
      maxRetries: 0,
    })

    await assert.rejects(async () => {
      await client.createMessage({
        messages: [createTextMessage('user', 'hello')],
      })
    }, error => {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /OpenAI request failed \(429 Too Many Requests\): rate limit exceeded/,
      )
      assert.ok(error instanceof RetryableHttpError)
      assert.equal(getProviderErrorKind(error), 'rate_limit')
      assert.equal(error.kind, 'rate_limit')
      return true
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient retries retryable rate limits and honors Retry-After', async () => {
  const sleepCalls: number[] = []
  let attempts = 0

  const server = createServer((_, response) => {
    attempts += 1
    if (attempts === 1) {
      response.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '1',
      })
      response.end(
        JSON.stringify({
          error: {
            message: 'try again shortly',
          },
        }),
      )
      return
    }

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'retried ok' }],
          },
        ],
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
      apiStyle: 'responses',
      defaultModel: 'gpt-5',
      sleepImpl: async ms => {
        sleepCalls.push(ms)
      },
    })

    const result = await client.createMessage({
      messages: [createTextMessage('user', 'hello')],
    })

    assert.equal(attempts, 2)
    assert.deepEqual(sleepCalls, [1000])
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'retried ok' },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient obeys x-should-retry false even for 5xx responses', async () => {
  let attempts = 0

  const server = createServer((_, response) => {
    attempts += 1
    response.writeHead(500, {
      'content-type': 'application/json',
      'x-should-retry': 'false',
    })
    response.end(
      JSON.stringify({
        error: {
          message: 'do not retry this',
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
      apiStyle: 'responses',
      defaultModel: 'gpt-5',
    })

    await assert.rejects(
      () =>
        client.createMessage({
          messages: [createTextMessage('user', 'hello')],
        }),
      /OpenAI request failed \(500 Internal Server Error\): do not retry this/,
    )
    assert.equal(attempts, 1)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient obeys x-should-retry true for otherwise non-retryable responses', async () => {
  let attempts = 0

  const server = createServer((_, response) => {
    attempts += 1
    if (attempts === 1) {
      response.writeHead(400, {
        'content-type': 'application/json',
        'x-should-retry': 'true',
      })
      response.end(
        JSON.stringify({
          error: {
            message: 'retry me once',
          },
        }),
      )
      return
    }

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'header retry ok' }],
          },
        ],
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
      apiStyle: 'responses',
      defaultModel: 'gpt-5',
      sleepImpl: async () => {},
    })

    const result = await client.createMessage({
      messages: [createTextMessage('user', 'hello')],
    })

    assert.equal(attempts, 2)
    assert.deepEqual(result.message.content, [
      { type: 'text', text: 'header retry ok' },
    ])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient retries transient network failures', async () => {
  let attempts = 0

  const client = new OpenAiLlmClient({
    apiKey: 'test-key',
    apiStyle: 'responses',
    defaultModel: 'gpt-5',
    sleepImpl: async () => {},
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) {
        throw new TypeError('fetch failed')
      }

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'network retry ok' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  })

  const result = await client.createMessage({
    messages: [createTextMessage('user', 'hello')],
  })

  assert.equal(attempts, 2)
  assert.deepEqual(result.message.content, [
    { type: 'text', text: 'network retry ok' },
  ])
})

test('OpenAiLlmClient retries request timeouts', async () => {
  let attempts = 0

  const client = new OpenAiLlmClient({
    apiKey: 'test-key',
    apiStyle: 'responses',
    defaultModel: 'gpt-5',
    maxRetries: 1,
    requestTimeoutMs: 20,
    sleepImpl: async () => {},
    fetchImpl: async (_input, init) => {
      attempts += 1
      if (attempts === 1) {
        const signal = init?.signal
        await new Promise((_, reject) => {
          if (!signal) {
            reject(new Error('Expected timeout signal'))
            return
          }

          if (signal.aborted) {
            const error = new Error('Request aborted')
            error.name = 'AbortError'
            reject(error)
            return
          }

          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('Request aborted')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true },
          )
        })
      }

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'timeout retry ok' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  })

  const result = await client.createMessage({
    messages: [createTextMessage('user', 'hello')],
  })

  assert.equal(attempts, 2)
  assert.deepEqual(result.message.content, [
    { type: 'text', text: 'timeout retry ok' },
  ])
})

test('OpenAiLlmClient defaults to Claude Code retry count', async () => {
  let attempts = 0

  const client = new OpenAiLlmClient({
    apiKey: 'test-key',
    apiStyle: 'responses',
    defaultModel: 'gpt-5',
    env: {},
    sleepImpl: async () => {},
    fetchImpl: async () => {
      attempts += 1
      return new Response(
        JSON.stringify({
          error: {
            message: 'temporary server failure',
          },
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  })

  await assert.rejects(() =>
    client.createMessage({
      messages: [createTextMessage('user', 'hello')],
    }),
  )

  assert.equal(attempts, 11)
})

test('getRetryDelayMs uses Claude Code backoff cap by default', () => {
  const delay = getRetryDelayMs(10, null)
  assert.ok(delay >= 32000)
  assert.ok(delay <= 40000)
})

test('getProviderErrorKind classifies transient fetch failures as network', () => {
  assert.equal(getProviderErrorKind(new TypeError('fetch failed')), 'network')
})

test('RetryableHttpError classifies overloaded responses distinctly', () => {
  const error = new RetryableHttpError(
    'OpenAI',
    529,
    'Overloaded',
    {
      message: 'service overloaded',
      type: 'overloaded_error',
    },
    new Headers(),
  )

  assert.equal(error.kind, 'overloaded')
  assert.equal(error.subtype, 'server_overload')
  assert.equal(getProviderErrorKind(error), 'overloaded')
  assert.equal(getProviderErrorSubtype(error), 'server_overload')
})

test('OpenAiLlmClient classifies insufficient quota responses distinctly', async () => {
  const server = createServer((_, response) => {
    response.writeHead(429, {
      'content-type': 'application/json',
    })
    response.end(
      JSON.stringify({
        error: {
          message: 'You exceeded your current quota, please check your plan and billing details.',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
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
      apiStyle: 'responses',
      defaultModel: 'gpt-5',
      maxRetries: 0,
    })

    await assert.rejects(
      () =>
        client.createMessage({
          messages: [createTextMessage('user', 'hello')],
        }),
      error => {
        assert.ok(error instanceof RetryableHttpError)
        assert.equal(error.kind, 'rate_limit')
        assert.equal(error.subtype, 'insufficient_quota')
        assert.equal(getProviderErrorSubtype(error), 'insufficient_quota')
        assert.equal(
          error.userMessage,
          'OpenAI quota is exhausted. Check billing, credits, or organization limits before retrying.',
        )
        return true
      },
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient classifies model availability failures distinctly', async () => {
  const server = createServer((_, response) => {
    response.writeHead(404, {
      'content-type': 'application/json',
    })
    response.end(
      JSON.stringify({
        error: {
          message: 'The model `gpt-missing` does not exist or you do not have access to it.',
          type: 'invalid_request_error',
          code: 'model_not_found',
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
      apiStyle: 'responses',
      defaultModel: 'gpt-5',
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
        assert.equal(error.subtype, 'model_not_found')
        assert.equal(
          error.userMessage,
          'The selected model is not available on OpenAI. Check the model name and account access.',
        )
        return true
      },
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('OpenAiLlmClient surfaces provider 400 responses when error.code is numeric', async () => {
  const server = createServer((_, response) => {
    response.writeHead(400, {
      'content-type': 'application/json',
    })
    response.end(
      JSON.stringify({
        error: {
          code: 400,
          message: 'Provider returned error',
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
      apiStyle: 'chat-completions',
      defaultModel: 'gpt-5',
      maxRetries: 0,
    })

    await assert.rejects(
      () =>
        client.createMessage({
          messages: [createTextMessage('user', 'hello')],
        }),
      error => {
        assert.ok(error instanceof RetryableHttpError)
        assert.equal(
          error.message,
          'OpenAI request failed (400 Bad Request): Provider returned error',
        )
        assert.equal(error.kind, 'bad_request')
        assert.equal(error.subtype, 'bad_request')
        assert.equal(error.errorCode, '400')
        return true
      },
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})
