import { readFile, stat } from 'node:fs/promises'
import {
  IMAGE_TARGET_RAW_SIZE,
  optimizeImageForModel,
} from '../../llm/imageProcessing.js'
import {
  createImageBlock,
  createTextMessage,
} from '../../types/message.js'
import type { ToolResult } from '../../types/tool.js'
import { runVisionSideQuery } from '../../llm/visionSideQuery.js'
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

const SUPPORTED_LOCAL_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

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

export type ReadToolOutput = ReadTextToolOutput | ReadImageToolOutput

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

function parseMediaType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function detectImageMediaTypeFromBuffer(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image/gif'
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  return undefined
}

function isSupportedLocalImageMediaType(contentType: string): boolean {
  return SUPPORTED_LOCAL_IMAGE_MEDIA_TYPES.has(parseMediaType(contentType))
}

function isSupportedLocalImageExtension(filePath: string): boolean {
  const extension = filePath.split('.').at(-1)?.toLowerCase() ?? ''
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)
}

function getUnsupportedImageRangeError(): string {
  return 'Read does not support offset or limit when reading image files'
}

function shouldUseVisionSideQuery(context: {
  supportsVisionInput?: boolean
  visionRuntime?: unknown
}): boolean {
  return context.supportsVisionInput === false && Boolean(context.visionRuntime)
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
    anyOf: [
      { required: ['file_path'] },
      { required: ['path'] },
    ],
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
                enum: [...SUPPORTED_LOCAL_IMAGE_MEDIA_TYPES],
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

    if (
      isSupportedLocalImageExtension(filePath) &&
      (input.offset !== undefined || input.limit !== undefined)
    ) {
      return {
        ok: false,
        error: getUnsupportedImageRangeError(),
      }
    }

    try {
      const fileStat = await stat(toAbsoluteToolPath(filePath))
      if (!fileStat.isFile()) {
        return {
          ok: false,
          error: 'Read can only read regular files',
        }
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code === 'ENOENT') {
        return {
          ok: false,
          error: `File does not exist: ${filePath}`,
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
    if (
      isSupportedLocalImageExtension(absolutePath) &&
      (input.offset !== undefined || input.limit !== undefined)
    ) {
      throw new Error(getUnsupportedImageRangeError())
    }

    const fileStat = await stat(absolutePath)
    if (isSupportedLocalImageExtension(absolutePath)) {
      if (fileStat.size > limits.maxImageSourceBytes) {
        throw new Error(
          `Read image source is too large (${fileStat.size} bytes). Limit is ${limits.maxImageSourceBytes} bytes.`,
        )
      }

      const imageBuffer = await readFile(absolutePath)
      const detectedMediaType = detectImageMediaTypeFromBuffer(imageBuffer)
      if (
        !detectedMediaType ||
        !isSupportedLocalImageMediaType(detectedMediaType)
      ) {
        throw new Error(
          `Read only supports local images with media types: ${[...SUPPORTED_LOCAL_IMAGE_MEDIA_TYPES].join(', ')}.`,
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

      if (context.supportsVisionInput === false && !context.visionRuntime) {
        throw new Error(
          'Read image requires either a vision-capable active runtime or a configured vision side query runtime.',
        )
      }

      if (shouldUseVisionSideQuery(context)) {
        const analysisText = await runVisionSideQuery({
          runtime: context.visionRuntime!,
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
      isPartial: startLine > 1 || limit !== undefined,
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
      isPartialView: output.isPartial,
      offset: startLine > 1 ? startLine : undefined,
      limit,
    })

    return {
      ok: true,
      output,
      summary: `Read ${absolutePath}`,
    }
  },
})
