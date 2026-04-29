import { open, readFile, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename } from 'node:path'
import {
  IMAGE_TARGET_RAW_SIZE,
  optimizeImageForModel,
} from '../../llm/imageProcessing.js'
import {
  createImageBlock,
  createPdfBlock,
  createTextMessage,
} from '../../types/message.js'
import {
  getToolSupportsImageInput,
  getToolSupportsPdfInput,
  getToolVisionRuntime,
  type ToolContext,
  type ToolResult,
} from '../../types/tool.js'
import { runVisionSideQuery } from '../../llm/visionSideQuery.js'
import {
  classifyLocalFileContent,
  isSupportedImageMediaType,
  SUPPORTED_IMAGE_MEDIA_TYPES,
} from '../contentTypes.js'
import {
  createUnsupportedContentResult,
  type UnsupportedContentToolOutput,
} from '../fileHandling.js'
import { buildTool, type Tool } from '../types.js'
import { isAbsoluteToolPath, toAbsoluteToolPath } from './pathUtils.js'
import { getDefaultReadLimits } from './readLimits.js'
import {
  DESCRIPTION as READ_DESCRIPTION,
  FILE_PATH_DESCRIPTION,
  LIMIT_DESCRIPTION,
  OFFSET_DESCRIPTION,
  PATH_ALIAS_DESCRIPTION,
  PROMPT,
} from './readFilePrompt.js'

export type ReadFileToolInput = {
  file_path?: string
  path?: string
  offset?: number
  limit?: number
}

export type ReadTextToolOutput = {
  type: 'text'
  file: {
    filePath: string
    content: string
    numLines: number
    startLine: number
    endLine: number
    totalLines: number
  }
  isPartial: boolean
  didReadToEnd: boolean
  warning?: string
}

export type ReadImageToolOutput = {
  type: 'image'
  file: {
    filePath: string
    mediaType: string
    sizeBytes: number
  }
  analysisText?: string
  analysisSource?: 'vision_side_query'
}

export type ReadPdfToolOutput = {
  type: 'pdf'
  file: {
    filePath: string
    mediaType: 'application/pdf'
    sizeBytes: number
    filename: string
  }
}

export type ReadToolOutput = ReadTextToolOutput | ReadImageToolOutput | ReadPdfToolOutput
  | UnsupportedContentToolOutput

function splitLogicalLines(text: string): string[] {
  if (text.length === 0) {
    return []
  }

  const lines = text.split(/\r?\n/)
  if (lines.length > 1 && lines.at(-1) === '') {
    return lines.slice(0, -1)
  }
  return lines
}

function getUnsupportedImageRangeError(): string {
  return 'Read does not support offset or limit when reading image files'
}

function shouldUseVisionSideQuery(
  context: Pick<ToolContext, 'runtimeProfile'>,
): boolean {
  return (
    getToolSupportsImageInput(context) === false &&
    Boolean(getToolVisionRuntime(context))
  )
}

function buildVisionFallbackResultText(input: {
  filePath: string
  sourceBytes: number
  sourceMediaType: string
  attachedBytes: number
  attachedMediaType: string
  estimatedTokens: number
  analysisText: string
}): string {
  return [
    `Read image file ${input.filePath} (${input.sourceBytes} source bytes, ${input.sourceMediaType}).`,
    `Because the active model runtime does not accept image input directly, dclaw analyzed an optimized ${input.attachedMediaType} payload (${input.attachedBytes} bytes, ~${input.estimatedTokens} tokens) through the configured vision side query.`,
    '',
    input.analysisText,
  ].join('\n')
}

function buildPdfResultText(input: {
  filePath: string
  sizeBytes: number
  filename: string
}): string {
  return `Read PDF file ${input.filePath} (${input.sizeBytes} bytes). Attached ${input.filename} below for document analysis.`
}

async function readFileProbe(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const probe = Buffer.alloc(64)
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0)
    return probe.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function getReadableFileStat(filePath: string): Promise<Stats> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error('Read can only read regular files')
    }
    return fileStat
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException
    if (fileError.code === 'ENOENT') {
      throw new Error(`File does not exist: ${filePath}`)
    }
    throw error
  }
}

export const readFileTool: Tool<ReadFileToolInput, ReadToolOutput> = buildTool({
  name: 'Read',
  description: READ_DESCRIPTION,
  // Keep the text path budget-aware. Image reads are self-bounded by the
  // source-image limit plus read-time optimization, and they return structured
  // content, so the aggregate tool-result budget skips them entirely.
  maxResultSizeChars: 50_000,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: FILE_PATH_DESCRIPTION,
      },
      path: {
        type: 'string',
        description: PATH_ALIAS_DESCRIPTION,
      },
      offset: {
        type: 'integer',
        minimum: 1,
        description: OFFSET_DESCRIPTION,
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: LIMIT_DESCRIPTION,
      },
    },
    // Keep alias validation in runtime code instead of a top-level anyOf.
    // Some OpenAI-compatible chat-completions gateways reject tool schemas
    // that combine object properties with root anyOf branches.
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string' },
      file: { type: 'object' },
      isPartial: { type: 'boolean' },
      didReadToEnd: { type: 'boolean' },
      warning: { type: 'string' },
    },
    anyOf: [
      {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['text'],
          },
          file: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              content: { type: 'string' },
              numLines: { type: 'integer' },
              startLine: { type: 'integer' },
              endLine: { type: 'integer' },
              totalLines: { type: 'integer' },
            },
            required: [
              'filePath',
              'content',
              'numLines',
              'startLine',
              'endLine',
              'totalLines',
            ],
            additionalProperties: false,
          },
          isPartial: { type: 'boolean' },
          didReadToEnd: { type: 'boolean' },
          warning: { type: 'string' },
        },
        required: ['type', 'file', 'isPartial', 'didReadToEnd'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['image'],
          },
          file: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              mediaType: {
                type: 'string',
                enum: [...SUPPORTED_IMAGE_MEDIA_TYPES],
              },
              sizeBytes: { type: 'integer' },
            },
            required: ['filePath', 'mediaType', 'sizeBytes'],
            additionalProperties: false,
          },
          analysisText: { type: 'string' },
          analysisSource: {
            type: 'string',
            enum: ['vision_side_query'],
          },
        },
        required: ['type', 'file'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['pdf'],
          },
          file: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              mediaType: {
                type: 'string',
                enum: ['application/pdf'],
              },
              sizeBytes: { type: 'integer' },
              filename: { type: 'string' },
            },
            required: ['filePath', 'mediaType', 'sizeBytes', 'filename'],
            additionalProperties: false,
          },
        },
        required: ['type', 'file'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['unsupported_content'],
          },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: [
                  'unsupported_content_type',
                  'unsupported_runtime_capability',
                ],
              },
              source: {
                type: 'string',
                enum: ['read'],
              },
              path: { type: 'string' },
              detectedMediaType: { type: 'string' },
              detectedExtension: { type: 'string' },
              contentKind: {
                type: 'string',
                enum: ['image', 'pdf', 'office_document', 'unknown_binary'],
              },
              suggestedNextSteps: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: [
                    'use_skill',
                    'use_bash_fallback',
                    'ask_for_text_alternative',
                    'configure_image_support',
                  ],
                },
              },
            },
            required: ['code', 'source', 'contentKind', 'suggestedNextSteps'],
            additionalProperties: false,
          },
        },
        required: ['type', 'error'],
        additionalProperties: false,
      },
    ],
  },
  async validate(input) {
    const filePath = (input.file_path ?? input.path)?.trim()

    if (!filePath || filePath.length === 0) {
      return {
        ok: false,
        error: 'Read requires a non-empty file_path or path',
      }
    }

    if (!isAbsoluteToolPath(filePath)) {
      return {
        ok: false,
        error: 'Read requires file_path/path to be absolute',
      }
    }

    if (
      input.offset !== undefined &&
      (!Number.isInteger(input.offset) || input.offset < 1)
    ) {
      return {
        ok: false,
        error: 'Read offset must be an integer greater than or equal to 1',
      }
    }

    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit < 1)
    ) {
      return {
        ok: false,
        error: 'Read limit must be a positive integer',
      }
    }

    try {
      const absolutePath = toAbsoluteToolPath(filePath)
      await getReadableFileStat(absolutePath)
      const classified = classifyLocalFileContent({
        filePath: absolutePath,
        probe: await readFileProbe(absolutePath),
      })

      if (
        classified.kind === 'image' &&
        (input.offset !== undefined || input.limit !== undefined)
      ) {
        return {
          ok: false,
          error: getUnsupportedImageRangeError(),
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        return {
          ok: false,
          error: error.message,
        }
      }
      throw error
    }

    return { ok: true }
  },
  isReadOnly() {
    return true
  },
  async call(input, context): Promise<ToolResult<ReadToolOutput>> {
    const filePath = (input.file_path ?? input.path)?.trim()
    if (!filePath) {
      throw new Error('Read requires a non-empty file_path or path')
    }
    const limits = getDefaultReadLimits()

    const absolutePath = toAbsoluteToolPath(filePath)
    const fileStat = await getReadableFileStat(absolutePath)
    const probe = await readFileProbe(absolutePath)
    const classified = classifyLocalFileContent({
      filePath: absolutePath,
      probe,
    })
    if (
      classified.kind === 'image' &&
      (input.offset !== undefined || input.limit !== undefined)
    ) {
      throw new Error(getUnsupportedImageRangeError())
    }

    if (classified.kind === 'pdf' && getToolSupportsPdfInput(context) === true) {
      if (fileStat.size > limits.maxImageSourceBytes) {
        throw new Error(
          `Read PDF source is too large (${fileStat.size} bytes). Limit is ${limits.maxImageSourceBytes} bytes.`,
        )
      }

      const pdfBase64 = await readFile(absolutePath, 'base64')
      const filename = basename(absolutePath)

      return {
        ok: true,
        output: {
          type: 'pdf',
          file: {
            filePath: absolutePath,
            mediaType: 'application/pdf',
            sizeBytes: fileStat.size,
            filename,
          },
        },
        content: [
          createPdfBlock(pdfBase64, filename),
        ],
        newMessages: [
          createTextMessage(
            'user',
            buildPdfResultText({
              filePath: absolutePath,
              sizeBytes: fileStat.size,
              filename,
            }),
          ),
        ],
        summary: `Read PDF ${absolutePath}`,
      }
    }

    if (classified.kind === 'pdf' || classified.kind === 'office_document' || classified.kind === 'unknown_binary') {
      return createUnsupportedContentResult(
        {
          code: 'unsupported_content_type',
          source: 'read',
          path: absolutePath,
          detectedMediaType: classified.detectedMediaType,
          detectedExtension: classified.detectedExtension,
          contentKind: classified.kind,
          suggestedNextSteps: ['use_skill', 'use_bash_fallback'],
        },
        `Read could not directly process ${absolutePath}`,
      )
    }

    if (classified.kind === 'image') {
      if (fileStat.size > limits.maxImageSourceBytes) {
        throw new Error(
          `Read image source is too large (${fileStat.size} bytes). Limit is ${limits.maxImageSourceBytes} bytes.`,
        )
      }

      const imageBuffer = await readFile(absolutePath)
      const detectedMediaType = classified.detectedMediaType
      if (
        !detectedMediaType ||
        !isSupportedImageMediaType(detectedMediaType)
      ) {
        throw new Error(
          `Read only supports local images with media types: ${[...SUPPORTED_IMAGE_MEDIA_TYPES].join(', ')}.`,
        )
      }

      const optimizedImage = await optimizeImageForModel(
        imageBuffer,
        detectedMediaType,
        { maxTokens: limits.maxTokens },
      )
      if (optimizedImage.buffer.length > IMAGE_TARGET_RAW_SIZE) {
        throw new Error(
          `Read image could not be reduced to the model attachment limit (${IMAGE_TARGET_RAW_SIZE} bytes raw payload target).`,
        )
      }
      if (optimizedImage.estimatedTokens > limits.maxTokens) {
        throw new Error(
          `Read image could not be reduced to the image token budget (${optimizedImage.estimatedTokens}/${limits.maxTokens} estimated tokens).`,
        )
      }

      const resultText = optimizedImage.wasOptimized
        ? `Read image file ${absolutePath} (${fileStat.size} source bytes, ${detectedMediaType}). Attached an optimized ${optimizedImage.mediaType} payload (${optimizedImage.buffer.length} bytes, ~${optimizedImage.estimatedTokens} tokens) for visual analysis.`
        : `Read image file ${absolutePath} (${optimizedImage.buffer.length} bytes, ${optimizedImage.mediaType}, ~${optimizedImage.estimatedTokens} tokens). The image is attached below for visual analysis.`

      const visionRuntime = getToolVisionRuntime(context)
      if (getToolSupportsImageInput(context) === false && !visionRuntime) {
        return createUnsupportedContentResult(
          {
            code: 'unsupported_runtime_capability',
            source: 'read',
            path: absolutePath,
            detectedMediaType,
            contentKind: 'image',
            suggestedNextSteps: [
              'ask_for_text_alternative',
              'configure_image_support',
            ],
          },
          `Read image ${absolutePath} requires image-capable runtime support`,
        )
      }

      if (shouldUseVisionSideQuery(context)) {
        const analysisText = await runVisionSideQuery({
          runtime: visionRuntime!,
          mediaType: optimizedImage.mediaType,
          data: optimizedImage.buffer.toString('base64'),
          sourceLabel: `Read ${absolutePath}`,
          currentUserRequest: context.currentUserRequest,
          toolUseIntent: context.toolUseIntent,
          queryTraceSink: context.queryTraceSink,
          iteration: context.currentIteration,
        })
        const fallbackResultText = buildVisionFallbackResultText({
          filePath: absolutePath,
          sourceBytes: fileStat.size,
          sourceMediaType: detectedMediaType,
          attachedBytes: optimizedImage.buffer.length,
          attachedMediaType: optimizedImage.mediaType,
          estimatedTokens: optimizedImage.estimatedTokens,
          analysisText,
        })

        return {
          ok: true,
          output: {
            type: 'image',
            file: {
              filePath: absolutePath,
              mediaType: optimizedImage.mediaType,
              sizeBytes: optimizedImage.buffer.length,
            },
            analysisText,
            analysisSource: 'vision_side_query',
          },
          content: [
            {
              type: 'text',
              text: fallbackResultText,
            },
          ],
          summary: `Read image ${absolutePath} via vision side query`,
        }
      }

      return {
        ok: true,
        output: {
          type: 'image',
          file: {
            filePath: absolutePath,
            mediaType: optimizedImage.mediaType,
            sizeBytes: optimizedImage.buffer.length,
          },
        },
        content: [
          createImageBlock(
            optimizedImage.mediaType,
            optimizedImage.buffer.toString('base64'),
          ),
        ],
        newMessages: [createTextMessage('user', resultText)],
        summary: `Read image ${absolutePath}`,
      }
    }

    if (
      input.limit === undefined &&
      fileStat.size > limits.maxSizeBytes
    ) {
      throw new Error(
        `Read file is too large (${fileStat.size} bytes) to return in one response. Use offset and limit to read specific portions of the file, or search for specific content instead of reading the whole file.`,
      )
    }

    const text = await readFile(absolutePath, 'utf8')
    const lines = splitLogicalLines(text)
    const startLine = input.offset ?? 1
    const limit = input.limit
    const startIndex = startLine - 1
    const selectedLines =
      limit === undefined
        ? lines.slice(startIndex)
        : lines.slice(startIndex, startIndex + limit)
    const endLine =
      selectedLines.length > 0 ? startLine + selectedLines.length - 1 : startLine - 1
    const didReadToEnd = startIndex >= lines.length
      ? true
      : startIndex + selectedLines.length >= lines.length
    const isPartial = startLine > 1 || !didReadToEnd
    const output: ReadTextToolOutput = {
      type: 'text',
      file: {
        filePath: absolutePath,
        content: selectedLines.join('\n'),
        numLines: selectedLines.length,
        startLine,
        endLine,
        totalLines: lines.length,
      },
      isPartial,
      didReadToEnd,
      warning:
        lines.length === 0
          ? 'The file exists but is empty.'
          : startIndex >= lines.length
            ? `The requested offset (${startLine}) is beyond the end of the file, which has ${lines.length} lines.`
            : undefined,
    }

    context.readState.set(absolutePath, {
      content: output.file.content,
      timestamp: Math.floor(fileStat.mtimeMs),
      isPartialView: isPartial,
      offset: startLine > 1 ? startLine : undefined,
      limit: isPartial ? limit : undefined,
    })

    return {
      ok: true,
      output,
      summary: `Read ${absolutePath}`,
    }
  },
})
