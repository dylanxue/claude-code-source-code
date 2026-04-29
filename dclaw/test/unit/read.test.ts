import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { createFileQueryTraceSink, createQueryTraceFilePath } from '../../src/core/queryTrace.js'
import { getMaxRawBytesForImageTokens } from '../../src/llm/imageProcessing.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import {
  readFileTool,
  type ReadTextToolOutput,
} from '../../src/tools/builtin/readFile.js'
import {
  getDefaultReadLimits,
} from '../../src/tools/builtin/readLimits.js'
import {
  createToolContext,
  createToolRuntimeProfile,
} from '../helpers/toolContext.js'

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function createNoisyPng(
  width: number,
  height: number,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 31) % 256
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

function expectTextOutput(
  output: { type: string },
): asserts output is ReadTextToolOutput {
  assert.equal(output.type, 'text')
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

test('Read description and schema nudge callers toward targeted large-file reads', () => {
  assert.match(
    readFileTool.description,
    /Read the whole file when it is reasonably small/,
  )
  assert.match(readFileTool.description, /use offset and limit/i)
  assert.match(readFileTool.description, /search for specific content first/i)
  assert.match(readFileTool.description, /supported local images/i)

  const properties = readFileTool.inputSchema.properties as
    | Record<string, { description?: string }>
    | undefined

  assert.equal('anyOf' in readFileTool.inputSchema, false)
  assert.match(properties?.offset?.description ?? '', /specific section/i)
  assert.match(properties?.limit?.description ?? '', /larger file/i)
})

test('Read returns structured image content for supported local images', async () => {
  const dir = await createTempDir('dclaw-read-image-')
  const filePath = join(dir, 'pixel.png')
  const context = createToolContext()
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII='

  try {
    await writeFile(filePath, Buffer.from(pngBase64, 'base64'))
    const result = await readFileTool.call(
      { file_path: filePath },
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.type, 'image')
    assert.equal(result.output.file.filePath, filePath)
    assert.equal(result.output.file.mediaType, 'image/png')
    assert.equal(result.output.file.sizeBytes, Buffer.from(pngBase64, 'base64').length)
    assert.equal(result.content?.length, 1)
    assert.equal(result.content?.[0]?.type, 'image')
    assert.equal(
      (result.content?.[0] as { type: 'image'; source: { mediaType: string; data: string } }).source.mediaType,
      'image/png',
    )
    assert.equal(
      (result.content?.[0] as { type: 'image'; source: { mediaType: string; data: string } }).source.data,
      pngBase64,
    )
    assert.equal(result.newMessages?.length, 1)
    assert.equal(result.newMessages?.[0]?.role, 'user')
    assert.match(
      ((result.newMessages?.[0]?.content[0] as { type: 'text'; text: string })?.text ?? ''),
      /attached below for visual analysis/i,
    )
    assert.equal(context.readState.has(filePath), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read falls back to a vision side query when the active runtime does not support image input', async () => {
  const dir = await createTempDir('dclaw-read-image-vision-fallback-')
  const filePath = join(dir, 'pixel.png')
  const visionClient = new VisionSideQueryClient(
    [
      'Visual findings',
      '- Visible text: none',
      '- Style / mood: soft gradient reference',
      '- Layout / composition: centered focal point',
      '- UI elements / state cues: none',
      '- Colors / typography / effects: blue glow',
      '- Uncertainties: none',
    ].join('\n'),
  )
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII='

  try {
    await writeFile(filePath, Buffer.from(pngBase64, 'base64'))
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext({
        runtimeProfile: createToolRuntimeProfile({
          supportsImageInput: false,
          imageFallback: {
            client: visionClient,
            provider: 'openai',
            model: 'vision-model',
          },
        }),
        currentUserRequest: '参考这张图的风格做一个 hero section',
        toolUseIntent: {
          source: 'assistant_text',
          text: '我先看下这张参考图的配色和光效细节。',
        },
      }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.type, 'image')
    assert.equal(result.output.analysisSource, 'vision_side_query')
    assert.match(result.output.analysisText ?? '', /Style \/ mood: soft gradient reference/)
    assert.equal(result.content?.length, 1)
    assert.equal(result.content?.[0]?.type, 'text')
    assert.match((result.content?.[0] as { type: 'text'; text: string }).text, /vision side query/i)
    assert.equal(result.newMessages?.length ?? 0, 0)
    assert.equal(visionClient.requests.length, 1)
    const visionPrompt = visionClient.requests[0]?.messages[0]
    assert.ok(visionPrompt)
    assert.equal(visionPrompt?.content[1]?.type, 'image')
    assert.match(
      (visionPrompt?.content[0] as { type: 'text'; text: string }).text,
      /Why this image is being read now \(assistant_text\):/,
    )
    assert.match(
      (visionPrompt?.content[0] as { type: 'text'; text: string }).text,
      /配色和光效细节/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns structured unsupported output when the active runtime does not support image input and no image fallback is configured', async () => {
  const dir = await createTempDir('dclaw-read-image-unsupported-')
  const filePath = join(dir, 'pixel.png')
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII='

  try {
    await writeFile(filePath, Buffer.from(pngBase64, 'base64'))
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext({
        runtimeProfile: createToolRuntimeProfile({
          supportsImageInput: false,
        }),
      }),
    )

    assert.equal(result.ok, false)
    assert.equal(result.output.type, 'unsupported_content')
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
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read records vision side query events in the query trace sink', async () => {
  const dir = await createTempDir('dclaw-read-image-vision-trace-')
  const filePath = join(dir, 'pixel.png')
  const tracePath = createQueryTraceFilePath()
  const queryTraceSink = await createFileQueryTraceSink(tracePath)
  const visionClient = new VisionSideQueryClient(
    [
      'Visual findings',
      '- Visible text: SALE',
      '- Style / mood: bright promo banner',
      '- Layout / composition: centered headline',
      '- UI elements / state cues: none',
      '- Colors / typography / effects: red accent',
      '- Uncertainties: none',
    ].join('\n'),
  )
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII='

  try {
    await writeFile(filePath, Buffer.from(pngBase64, 'base64'))
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext({
        currentIteration: 3,
        queryTraceSink,
        runtimeProfile: createToolRuntimeProfile({
          supportsImageInput: false,
          imageFallback: {
            client: visionClient,
            provider: 'openai',
            model: 'vision-model',
          },
        }),
        currentUserRequest: '参考这张图做一个促销 banner',
        toolUseIntent: {
          source: 'assistant_text',
          text: '我先提取这张图里的主视觉风格和文案线索。',
        },
      }),
    )

    assert.equal(result.ok, true)
    await queryTraceSink.flush()

    const traceText = await readFile(tracePath, 'utf8')
    const traceEvents = traceText
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as {
        event: string
        iteration?: number
        data?: Record<string, unknown>
      })

    assert.deepEqual(
      traceEvents.map((event) => event.event),
      ['vision_side_query.start', 'vision_side_query.complete'],
    )
    assert.equal(traceEvents[0]?.iteration, 3)
    assert.equal(traceEvents[0]?.data?.provider, 'openai')
    assert.equal(traceEvents[0]?.data?.model, 'vision-model')
    assert.equal(traceEvents[0]?.data?.intentSource, 'assistant_text')
    assert.match(String(traceEvents[0]?.data?.intentPreview ?? ''), /主视觉风格和文案线索/)
    assert.equal(traceEvents[1]?.iteration, 3)
    assert.match(String(traceEvents[1]?.data?.outputPreview ?? ''), /Visual findings/)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(tracePath, { force: true })
  }
})

test('Read downscales oversized-dimension local images before attaching them', async () => {
  const dir = await createTempDir('dclaw-read-image-resize-')
  const filePath = join(dir, 'large.png')
  const context = createToolContext()
  const sourceBuffer = await sharp({
    create: {
      width: 3_000,
      height: 3_000,
      channels: 3,
      background: { r: 20, g: 120, b: 220 },
    },
  })
    .png()
    .toBuffer()

  try {
    await writeFile(filePath, sourceBuffer)
    const result = await readFileTool.call(
      { file_path: filePath },
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.type, 'image')
    assert.equal(result.output.file.filePath, filePath)
    assert.equal(result.output.file.mediaType, 'image/png')
    assert.equal(result.content?.length, 1)
    const imageBlock = result.content?.[0]
    assert.ok(imageBlock && imageBlock.type === 'image')

    const optimizedBuffer = Buffer.from(imageBlock.source.data, 'base64')
    const metadata = await sharp(optimizedBuffer).metadata()
    assert.equal(metadata.width, 2_000)
    assert.equal(metadata.height, 2_000)
    assert.equal(result.output.file.sizeBytes, optimizedBuffer.length)
    assert.ok(optimizedBuffer.length < sourceBuffer.length)
    assert.match(
      ((result.newMessages?.[0]?.content[0] as { type: 'text'; text: string })?.text ?? ''),
      /Attached an optimized image\/png payload/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read applies token-aware compression for dense local images', async () => {
  const dir = await createTempDir('dclaw-read-image-token-budget-')
  const filePath = join(dir, 'dense.png')
  const sourceBuffer = await createNoisyPng(1_400, 1_400)
  const limits = getDefaultReadLimits()
  const tokenBudgetBytes = getMaxRawBytesForImageTokens(limits.maxTokens)

  try {
    assert.ok(sourceBuffer.length > tokenBudgetBytes)
    await writeFile(filePath, sourceBuffer)
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.type, 'image')
    const imageBlock = result.content?.[0]
    assert.ok(imageBlock && imageBlock.type === 'image')

    const optimizedBuffer = Buffer.from(imageBlock.source.data, 'base64')
    assert.ok(optimizedBuffer.length <= tokenBudgetBytes)
    assert.ok(result.output.file.sizeBytes <= tokenBudgetBytes)
    assert.match(
      ((result.newMessages?.[0]?.content[0] as { type: 'text'; text: string })?.text ?? ''),
      /~\d+ tokens/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read rejects oversized local image sources', async () => {
  const dir = await createTempDir('dclaw-read-image-large-')
  const filePath = join(dir, 'large.png')
  const limits = getDefaultReadLimits()

  try {
    const sourceBuffer = await createNoisyPng(3_000, 3_000)
    assert.ok(sourceBuffer.length > limits.maxImageSourceBytes)
    await writeFile(filePath, sourceBuffer)

    await assert.rejects(
      () => readFileTool.call({ file_path: filePath }, createToolContext()),
      /Read image source is too large/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read treats files with image extensions but non-image binary content as unsupported binary files', async () => {
  const dir = await createTempDir('dclaw-read-fake-image-')
  const filePath = join(dir, 'fake.png')

  try {
    await writeFile(filePath, Buffer.alloc(256))
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, false)
    assert.equal(result.output.type, 'unsupported_content')
    assert.equal(result.output.error.source, 'read')
    assert.equal(result.output.error.contentKind, 'unknown_binary')
    assert.equal(result.output.error.detectedExtension, 'png')
    assert.match(
      (result.content?.[0] as { type: 'text'; text: string }).text,
      /cannot directly process this binary file/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns structured unsupported output for local PDF files', async () => {
  const dir = await createTempDir('dclaw-read-pdf-')
  const filePath = join(dir, 'sample.pdf')

  try {
    await writeFile(filePath, Buffer.from('%PDF-1.7\n%test\n', 'utf8'))
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, false)
    assert.equal(result.output.type, 'unsupported_content')
    assert.equal(result.output.error.source, 'read')
    assert.equal(result.output.error.contentKind, 'pdf')
    assert.equal(result.output.error.path, filePath)
    assert.deepEqual(result.output.error.suggestedNextSteps, [
      'use_skill',
      'use_bash_fallback',
    ])
    assert.equal(result.content?.[0]?.type, 'text')
    assert.match(
      (result.content?.[0] as { type: 'text'; text: string }).text,
      /Call the Skill tool with skill_name: `pdf`/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read attaches PDF content directly when the active runtime supports pdf input', async () => {
  const dir = await createTempDir('dclaw-read-pdf-direct-')
  const filePath = join(dir, 'sample.pdf')

  try {
    await writeFile(filePath, Buffer.from('%PDF-1.7\n%test\n', 'utf8'))
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext({
        runtimeProfile: createToolRuntimeProfile({
          supportsImageInput: true,
          supportsPdfInput: true,
        }),
      }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.type, 'pdf')
    assert.equal(result.output.file.filePath, filePath)
    assert.equal(result.output.file.mediaType, 'application/pdf')
    assert.equal(result.output.file.filename, 'sample.pdf')
    assert.equal(result.content?.length, 1)
    assert.equal(result.content?.[0]?.type, 'pdf')
    assert.equal(result.newMessages?.[0]?.role, 'user')
    assert.match(
      ((result.newMessages?.[0]?.content[0] as { type: 'text'; text: string })?.text ?? ''),
      /Attached sample\.pdf below for document analysis/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns structured unsupported output for local office documents', async () => {
  const dir = await createTempDir('dclaw-read-docx-')
  const filePath = join(dir, 'sample.docx')

  try {
    await writeFile(filePath, Buffer.from('PK\x03\x04docx', 'binary'))
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, false)
    assert.equal(result.output.type, 'unsupported_content')
    assert.equal(result.output.error.contentKind, 'office_document')
    assert.equal(result.output.error.detectedExtension, 'docx')
    assert.equal(result.content?.[0]?.type, 'text')
    assert.match(
      (result.content?.[0] as { type: 'text'; text: string }).text,
      /Call the Skill tool with skill_name: `doc`/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read rejects offset and limit when reading local images', async () => {
  const dir = await createTempDir('dclaw-read-image-range-')
  const filePath = join(dir, 'pixel.png')
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII='

  try {
    await writeFile(filePath, Buffer.from(pngBase64, 'base64'))

    const validation = await readFileTool.validate?.(
      { file_path: filePath, offset: 1, limit: 1 },
      createToolContext(),
    )

    assert.deepEqual(validation, {
      ok: false,
      error: 'Read does not support offset or limit when reading image files',
    })

    await assert.rejects(
      () =>
        readFileTool.call(
          { file_path: filePath, offset: 1, limit: 1 },
          createToolContext(),
        ),
      /Read does not support offset or limit when reading image files/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns isPartial for ranged reads', async () => {
  const dir = await createTempDir('dclaw-read-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'a\nb\nc\n', 'utf8')
    const result = await readFileTool.call(
      { file_path: filePath, offset: 2, limit: 1 },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectTextOutput(result.output)
    assert.equal(result.output.isPartial, true)
    assert.equal(result.output.didReadToEnd, false)
    assert.equal(result.output.file.content, 'b')
    assert.equal(result.output.file.startLine, 2)
    assert.equal(result.output.file.endLine, 2)
    assert.equal(result.output.file.totalLines, 3)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read treats offset 1 with a limit reaching EOF as a full read', async () => {
  const dir = await createTempDir('dclaw-read-full-range-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'a\nb\nc\n', 'utf8')
    const result = await readFileTool.call(
      { file_path: filePath, offset: 1, limit: 1000 },
      context,
    )

    assert.equal(result.ok, true)
    expectTextOutput(result.output)
    assert.equal(result.output.isPartial, false)
    assert.equal(result.output.didReadToEnd, true)
    assert.equal(result.output.file.content, 'a\nb\nc')
    assert.equal(context.readState.get(filePath)?.isPartialView, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns warning for empty files', async () => {
  const dir = await createTempDir('dclaw-read-empty-')
  const filePath = join(dir, 'empty.txt')

  try {
    await writeFile(filePath, '', 'utf8')
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectTextOutput(result.output)
    assert.equal(result.output.file.numLines, 0)
    assert.equal(result.output.file.endLine, 0)
    assert.equal(result.output.didReadToEnd, true)
    assert.equal(result.output.warning, 'The file exists but is empty.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns warning when offset is beyond end of file', async () => {
  const dir = await createTempDir('dclaw-read-range-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'a\nb\n', 'utf8')
    const result = await readFileTool.call(
      { file_path: filePath, offset: 10 },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectTextOutput(result.output)
    assert.match(result.output.warning ?? '', /offset \(10\) is beyond the end/)
    assert.equal(result.output.file.content, '')
    assert.equal(result.output.file.endLine, 9)
    assert.equal(result.output.didReadToEnd, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read validation rejects directory paths', async () => {
  const dir = await createTempDir('dclaw-read-dir-')
  const subdir = join(dir, 'subdir')

  try {
    await mkdir(subdir)
    const validation = await readFileTool.validate?.(
      { file_path: subdir },
      createToolContext(),
    )

    assert.deepEqual(validation, {
      ok: false,
      error: 'Read can only read regular files',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read validation rejects missing files', async () => {
  const missingPath = join(
    tmpdir(),
    `dclaw-missing-${Date.now()}`,
    'missing.txt',
  )

  const validation = await readFileTool.validate?.(
    { file_path: missingPath },
    createToolContext(),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: `File does not exist: ${missingPath}`,
  })
})

test('Read accepts path as an alias for file_path', async () => {
  const dir = await createTempDir('dclaw-read-path-alias-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'alias works\n', 'utf8')
    const validation = await readFileTool.validate?.(
      { path: filePath },
      createToolContext(),
    )

    assert.deepEqual(validation, { ok: true })

    const result = await readFileTool.call(
      { path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectTextOutput(result.output)
    assert.equal(result.output.file.filePath, filePath)
    assert.equal(result.output.file.content, 'alias works')
    assert.equal(result.output.file.endLine, 1)
    assert.equal(result.output.didReadToEnd, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read rejects oversized full-file reads without an explicit limit', async () => {
  const dir = await createTempDir('dclaw-read-large-')
  const filePath = join(dir, 'large.txt')

  try {
    await writeFile(filePath, 'x'.repeat(300_000), 'utf8')

    await assert.rejects(
      () => readFileTool.call({ file_path: filePath }, createToolContext()),
      /Use offset and limit to read specific portions of the file, or search for specific content instead of reading the whole file/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read still allows oversized files when the caller provides a limit', async () => {
  const dir = await createTempDir('dclaw-read-large-limited-')
  const filePath = join(dir, 'large.txt')

  try {
    await writeFile(filePath, `${'x'.repeat(300_000)}\nsecond line\n`, 'utf8')
    const result = await readFileTool.call(
      {
        file_path: filePath,
        limit: 1,
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    expectTextOutput(result.output)
    assert.equal(result.output.isPartial, true)
    assert.equal(result.output.didReadToEnd, false)
    assert.equal(result.output.file.numLines, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
