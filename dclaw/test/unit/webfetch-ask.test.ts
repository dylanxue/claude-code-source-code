import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { getMaxRawBytesForImageTokens } from '../../src/llm/imageProcessing.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import {
  webFetchTool,
  type WebFetchToolOutput,
} from '../../src/tools/builtin/webFetch.js'
import { validateJsonSchema } from '../../src/tools/schema.js'
import { askUserQuestionTool } from '../../src/tools/builtin/askUserQuestion.js'
import { getDefaultReadLimits } from '../../src/tools/builtin/readLimits.js'
import {
  createToolContext,
  createToolRuntimeProfile,
} from '../helpers/toolContext.js'

type UnsupportedWebFetchOutput = Extract<
  WebFetchToolOutput,
  { type: 'unsupported_content' }
>

type SuccessfulWebFetchOutput = Exclude<
  WebFetchToolOutput,
  UnsupportedWebFetchOutput
>

async function createNoisyPng(
  width: number,
  height: number,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 17) % 256
  }

  return sharp(pixels, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .png({ compressionLevel: 0 })
    .toBuffer()
}

class VisionSideQueryClient implements LlmClient {
  readonly providerName = 'vision-test'
  readonly requests: CreateMessageRequest[] = []

  constructor(private readonly responseText: string) {}

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: {
        id: 'msg_vision_response',
        role: 'assistant',
        createdAt: new Date().toISOString(),
        content: [
          {
            type: 'text',
            text: this.responseText,
          },
        ],
      },
    }
  }
}

function expectSuccessfulWebFetchOutput(
  output: WebFetchToolOutput,
): asserts output is SuccessfulWebFetchOutput {
  assert.notEqual(
    (output as { type?: string }).type,
    'unsupported_content',
  )
}

function expectUnsupportedWebFetchOutput(
  output: WebFetchToolOutput,
): asserts output is UnsupportedWebFetchOutput {
  assert.equal(
    (output as { type?: string }).type,
    'unsupported_content',
  )
}

test('WebFetch strips HTML and includes prompt context', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<html><head><title>Example</title><meta name="description" content="Sample page"></head><body><h1>Hello</h1><script>ignored()</script><p>World</p></body></html>',
    )
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/`,
        prompt: 'Summarize the page',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.equal(result.output.code, 200)
    assert.match(result.output.result, /Prompt: Summarize the page/)
    assert.match(result.output.result, /Title: Example/)
    assert.match(result.output.result, /Description: Sample page/)
    assert.match(result.output.result, /Content-Type: text\/html/)
    assert.match(result.output.result, /Hello[\s\S]*World/)
    assert.doesNotMatch(result.output.result, /ignored\(\)/)
    assert.equal(result.output.wasTruncated, false)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch returns redirect instructions when the destination host changes', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/start') {
      response.writeHead(302, {
        location: 'https://example.com/final',
      })
      response.end()
      return
    }

    response.writeHead(404)
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/start`,
        prompt: 'Summarize the page',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.equal(result.output.code, 302)
    assert.match(result.output.result, /REDIRECT DETECTED/)
    assert.match(result.output.result, /https:\/\/example\.com\/final/)
    assert.equal(result.output.wasTruncated, false)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch validation rejects unsupported URL protocols', async () => {
  const validation = await webFetchTool.validate?.(
    {
      url: 'ftp://example.com/file.txt',
      prompt: 'Summarize the file',
    },
    createToolContext(),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'WebFetch only supports http and https URLs',
  })
})

test('WebFetch prefers prompt-relevant excerpts over unrelated sections', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`
      <html>
        <body>
          <section><h2>Introduction</h2><p>This page describes several product areas.</p></section>
          <section><h2>Pricing</h2><p>Starter costs $9 per month and Pro costs $29 per month.</p></section>
          <section><h2>Careers</h2><p>We are hiring across product, design, and operations.</p></section>
        </body>
      </html>
    `)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/`,
        prompt: 'What pricing plans and monthly costs are listed?',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.match(result.output.result, /Relevant excerpts for the prompt:/)
    assert.match(result.output.result, /Starter costs \$9 per month/)
    assert.doesNotMatch(result.output.result, /hiring across product/)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch falls back to leading excerpts for generic prompts', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(
      'Opening summary.\n\nMiddle details about the document.\n\nFinal appendix.',
    )
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/`,
        prompt: 'Summarize the page',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.deepEqual(
      validateJsonSchema(result.output, webFetchTool.outputSchema),
      { ok: true },
    )
    assert.match(result.output.result, /Leading excerpt from the page:/)
    assert.match(result.output.result, /Opening summary/)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch accepts markdown responses under the declared output schema', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
    response.end(
      '# SkillHub Install\n\nRun `curl -fsSL https://example.com/install.sh | bash -s -- --cli-only`.\n\nThen run `skillhub --dir .dclaw/skills install agent-browser`.',
    )
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/install.md`,
        prompt: '提取完整的 SkillHub 安装说明，特别是 CLI 安装方式和技能安装方式，包括所有命令和步骤',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.deepEqual(
      validateJsonSchema(result.output, webFetchTool.outputSchema),
      { ok: true },
    )
    assert.equal(result.output.contentType, 'text/markdown; charset=utf-8')
    assert.match(result.output.result, /skillhub --dir \.dclaw\/skills install agent-browser/i)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch returns structured image content for supported remote images', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxL8AAAAASUVORK5CYII=',
    'base64',
  )
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(pngBytes.length),
    })
    response.end(pngBytes)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/cat.png`,
        prompt: 'Describe the image',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.equal(result.output.contentKind, 'image')
    assert.equal(result.output.mediaType, 'image/png')
    assert.equal(result.output.bytes, pngBytes.length)
    assert.match(result.output.result, /Downloaded image content/)
    assert.deepEqual(
      result.content?.map(block => block.type),
      ['text', 'image'],
    )
    const imageBlock = result.content?.[1]
    assert.ok(imageBlock && imageBlock.type === 'image')
    assert.equal(imageBlock.source.mediaType, 'image/png')
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch returns structured unsupported output for remote PDFs', async () => {
  const pdfBytes = Buffer.from('%PDF-1.7\n%test\n', 'utf8')
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': String(pdfBytes.length),
    })
    response.end(pdfBytes)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/report.pdf`,
        prompt: 'Summarize the report',
      },
      createToolContext(),
    )

    assert.equal(result.ok, false)
    expectUnsupportedWebFetchOutput(result.output)
    assert.equal(result.output.type, 'unsupported_content')
    assert.equal(result.output.error.source, 'webfetch')
    assert.equal(result.output.error.contentKind, 'pdf')
    assert.equal(result.output.error.detectedMediaType, 'application/pdf')
    assert.equal(result.content?.[0]?.type, 'text')
    assert.match(
      (result.content?.[0] as { type: 'text'; text: string }).text,
      /Call the Skill tool with skill_name: `pdf`/i,
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch attaches PDF content directly when the active runtime supports pdf input', async () => {
  const pdfBytes = Buffer.from('%PDF-1.7\n%test\n', 'utf8')
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': String(pdfBytes.length),
    })
    response.end(pdfBytes)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/report.pdf`,
        prompt: 'Summarize the report',
      },
      createToolContext({
        runtimeProfile: createToolRuntimeProfile({
          supportsPdfInput: true,
        }),
      }),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.equal(result.output.contentKind, 'pdf')
    assert.equal(result.output.mediaType, 'application/pdf')
    assert.equal(result.output.bytes, pdfBytes.length)
    assert.match(result.output.result, /Attached report\.pdf below for document analysis/i)
    assert.deepEqual(
      result.content?.map(block => block.type),
      ['text', 'pdf'],
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch returns structured unsupported output for remote office documents', async () => {
  const bytes = Buffer.from('PK\x03\x04xlsx', 'binary')
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-length': String(bytes.length),
    })
    response.end(bytes)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/sheet.xlsx`,
        prompt: 'Analyze the spreadsheet',
      },
      createToolContext(),
    )

    assert.equal(result.ok, false)
    expectUnsupportedWebFetchOutput(result.output)
    assert.equal(result.output.type, 'unsupported_content')
    assert.equal(result.output.error.contentKind, 'office_document')
    assert.equal(result.output.error.detectedExtension, 'xlsx')
    assert.match(
      (result.content?.[0] as { type: 'text'; text: string }).text,
      /Call the Skill tool with skill_name: `spreadsheet`/i,
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch falls back to a vision side query when the active runtime does not support image input', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxL8AAAAASUVORK5CYII=',
    'base64',
  )
  const visionClient = new VisionSideQueryClient(
    [
      'Visual findings',
      '- Visible text: none',
      '- Style / mood: clean, minimal reference',
      '- Layout / composition: compact centered icon',
      '- UI elements / state cues: none',
      '- Colors / typography / effects: bright blue accent',
      '- Uncertainties: none',
    ].join('\n'),
  )
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(pngBytes.length),
    })
    response.end(pngBytes)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/cat.png`,
        prompt: 'Describe the image',
      },
      createToolContext({
        runtimeProfile: createToolRuntimeProfile({
          supportsImageInput: false,
          imageFallback: {
            client: visionClient,
            provider: 'openai',
            model: 'vision-model',
          },
        }),
        currentUserRequest: '参考这张图做一个风格接近的设计',
        toolUseIntent: {
          source: 'reasoning',
          text: '需要看一下这张图片的整体风格和蓝色高光效果。',
        },
      }),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.equal(result.output.contentKind, 'image')
    assert.match(result.output.result, /Vision side query analysis:/)
    assert.match(result.output.result, /clean, minimal reference/)
    assert.deepEqual(
      result.content?.map(block => block.type),
      ['text'],
    )
    assert.equal(visionClient.requests.length, 1)
    const visionPrompt = visionClient.requests[0]?.messages[0]
    assert.ok(visionPrompt)
    assert.equal(visionPrompt?.content[1]?.type, 'image')
    assert.match(
      (visionPrompt?.content[0] as { type: 'text'; text: string }).text,
      /Why this image is being read now \(reasoning\):/,
    )
    assert.match(
      (visionPrompt?.content[0] as { type: 'text'; text: string }).text,
      /蓝色高光效果/,
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch returns structured unsupported output when the active runtime does not support image input and no image fallback is configured', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxL8AAAAASUVORK5CYII=',
    'base64',
  )
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(pngBytes.length),
    })
    response.end(pngBytes)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/cat.png`,
        prompt: 'Describe the image',
      },
      createToolContext({
        runtimeProfile: createToolRuntimeProfile({
          supportsImageInput: false,
        }),
      }),
    )

    assert.equal(result.ok, false)
    expectUnsupportedWebFetchOutput(result.output)
    assert.equal(result.output.error.code, 'unsupported_runtime_capability')
    assert.equal(result.output.error.contentKind, 'image')
    assert.deepEqual(result.output.error.suggestedNextSteps, [
      'ask_for_text_alternative',
      'configure_image_support',
    ])
    assert.match(
      (result.content?.[0] as { type: 'text'; text: string }).text,
      /does not accept image input and no image fallback runtime is configured/i,
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch downscales oversized-dimension remote images before attaching them', async () => {
  const sourceBuffer = await sharp({
    create: {
      width: 3_000,
      height: 3_000,
      channels: 3,
      background: { r: 180, g: 80, b: 30 },
    },
  })
    .png()
    .toBuffer()

  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(sourceBuffer.length),
    })
    response.end(sourceBuffer)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/large.png`,
        prompt: 'Describe the image',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.equal(result.output.contentKind, 'image')
    assert.equal(result.output.mediaType, 'image/png')
    const imageBlock = result.content?.[1]
    assert.ok(imageBlock && imageBlock.type === 'image')
    const optimizedBuffer = Buffer.from(imageBlock.source.data, 'base64')
    const metadata = await sharp(optimizedBuffer).metadata()
    assert.equal(metadata.width, 2_000)
    assert.equal(metadata.height, 2_000)
    assert.equal(result.output.bytes, optimizedBuffer.length)
    assert.ok(optimizedBuffer.length < sourceBuffer.length)
    assert.match(result.output.result, /attached an optimized image\/png payload/i)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch applies token-aware compression for dense remote images', async () => {
  const sourceBuffer = await createNoisyPng(1_400, 1_400)
  const limits = getDefaultReadLimits()
  const tokenBudgetBytes = getMaxRawBytesForImageTokens(limits.maxTokens)
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(sourceBuffer.length),
    })
    response.end(sourceBuffer)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    assert.ok(sourceBuffer.length > tokenBudgetBytes)
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/dense.png`,
        prompt: 'Describe the image',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectSuccessfulWebFetchOutput(result.output)
    assert.equal(result.output.contentKind, 'image')
    const imageBlock = result.content?.[1]
    assert.ok(imageBlock && imageBlock.type === 'image')
    const optimizedBuffer = Buffer.from(imageBlock.source.data, 'base64')
    assert.ok(optimizedBuffer.length <= tokenBudgetBytes)
    assert.ok(result.output.bytes <= tokenBudgetBytes)
    assert.match(result.output.result, /~\d+ tokens/i)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('WebFetch returns structured unsupported output for remote image media types outside the built-in path', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'image/svg+xml' })
    response.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/vector.svg`,
        prompt: 'Describe the image',
      },
      createToolContext(),
    )

    assert.equal(result.ok, false)
    expectUnsupportedWebFetchOutput(result.output)
    assert.equal(result.output.type, 'unsupported_content')
    assert.equal(result.output.error.source, 'webfetch')
    assert.equal(result.output.error.contentKind, 'unknown_binary')
    assert.equal(result.output.error.detectedMediaType, 'image/svg+xml')
    assert.equal(result.output.error.detectedExtension, 'svg')
    assert.match(
      (result.content?.[0] as { type: 'text'; text: string }).text,
      /Call the Skill tool with an appropriate document-analysis skill/i,
    )
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AskUserQuestion uses host answers when available', async () => {
  const result = await askUserQuestionTool.call(
    {
      questions: [
        {
          id: 'choice',
          header: 'Choice',
          question: 'Pick one',
          options: [
            { label: 'A', description: 'Option A' },
            { label: 'B', description: 'Option B' },
          ],
        },
      ],
    },
    createToolContext({
      askUserQuestions: async () => ({ choice: 'A' }),
    }),
  )

  assert.equal(result.ok, true)
  assert.deepEqual(result.output.answers, { choice: 'A' })
})

test('AskUserQuestion maps preview exit actions into Claude Code style feedback', async () => {
  let receivedAllowPreviewActions: boolean | undefined
  const result = await askUserQuestionTool.call(
    {
      questions: [
        {
          id: 'plan_choice',
          header: 'Plan',
          question: 'Which plan should we follow?',
          options: [
            {
              label: 'Option A',
              description: 'Keep the current approach.',
              preview: '# Plan A\n\n- Keep interview flow\n- Add notes',
            },
            {
              label: 'Option B',
              description: 'Refactor the interaction model.',
            },
          ],
        },
      ],
    },
    createToolContext({
      permissionMode: 'plan',
      askUserQuestions: async (_questions, options) => {
        receivedAllowPreviewActions = options?.allowPreviewActions
        return {
        answers: { plan_choice: 'Option A' },
        annotations: {
          plan_choice: {
            preview: '# Plan A\n\n- Keep interview flow\n- Add notes',
            notes: 'This is enough context for now.',
          },
        },
        action: 'finish_plan_interview',
        }
      },
    }),
  )

  assert.equal(result.ok, true)
  assert.equal(receivedAllowPreviewActions, true)
  assert.equal(result.output.action, 'finish_plan_interview')
  assert.match(
    result.output.message ?? '',
    /Stop asking clarifying questions and proceed to finish the plan/,
  )
  assert.deepEqual(result.output.annotations, {
    plan_choice: {
      preview: '# Plan A\n\n- Keep interview flow\n- Add notes',
      notes: 'This is enough context for now.',
    },
  })

  const mapped = askUserQuestionTool.mapToolResult(result)
  assert.deepEqual(mapped, {
    action: 'finish_plan_interview',
    message: result.output.message,
    answers: { plan_choice: 'Option A' },
    annotations: {
      plan_choice: {
        preview: '# Plan A\n\n- Keep interview flow\n- Add notes',
        notes: 'This is enough context for now.',
      },
    },
  })
})

test('AskUserQuestion normalizes prefilled answers to question ids', async () => {
  const result = await askUserQuestionTool.call(
    {
      questions: [
        {
          id: 'framework',
          header: 'Stack',
          question: 'Which framework should we use?',
          options: [
            { label: 'React', description: 'Use React' },
            { label: 'Vue', description: 'Use Vue' },
          ],
        },
      ],
      answers: {
        'Which framework should we use?': 'React',
      },
    },
    createToolContext(),
  )

  assert.equal(result.ok, true)
  assert.deepEqual(result.output.answers, {
    framework: 'React',
  })
})

test('AskUserQuestion validation rejects missing interactive host', async () => {
  const validation = await askUserQuestionTool.validate?.(
    {
      questions: [
        {
          header: 'Choice',
          question: 'Pick one',
          options: [
            { label: 'A', description: 'Option A' },
            { label: 'B', description: 'Option B' },
          ],
        },
      ],
    },
    createToolContext(),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'AskUserQuestion requires an interactive host',
  })
})

test('AskUserQuestion validation rejects too many questions', async () => {
  const questions = Array.from({ length: 5 }, (_, index) => ({
    header: `Q${index}`,
    question: `Question ${index}`,
    options: [
      { label: 'A', description: 'Option A' },
      { label: 'B', description: 'Option B' },
    ],
  }))

  const validation = await askUserQuestionTool.validate?.(
    { questions },
    createToolContext({
      askUserQuestions: async () => ({}),
    }),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'AskUserQuestion supports at most 4 questions',
  })
})

test('AskUserQuestion validation rejects duplicate option labels', async () => {
  const validation = await askUserQuestionTool.validate?.(
    {
      questions: [
        {
          header: 'Choice',
          question: 'Pick one',
          options: [
            { label: 'A', description: 'Option A' },
            { label: 'A', description: 'Option A again' },
          ],
        },
      ],
    },
    createToolContext({
      askUserQuestions: async () => ({}),
    }),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'Each AskUserQuestion item requires unique option labels',
  })
})

test('AskUserQuestion validation rejects duplicate question ids', async () => {
  const validation = await askUserQuestionTool.validate?.(
    {
      questions: [
        {
          id: 'same',
          header: 'One',
          question: 'Pick one',
          options: [
            { label: 'A', description: 'Option A' },
            { label: 'B', description: 'Option B' },
          ],
        },
        {
          id: 'same',
          header: 'Two',
          question: 'Pick two',
          options: [
            { label: 'C', description: 'Option C' },
            { label: 'D', description: 'Option D' },
          ],
        },
      ],
    },
    createToolContext({
      askUserQuestions: async () => ({}),
    }),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'AskUserQuestion requires unique question ids or question texts',
  })
})
