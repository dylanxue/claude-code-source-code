import { readFile, stat } from 'node:fs/promises'
import type { ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { isAbsoluteToolPath, toAbsoluteToolPath } from './pathUtils.js'
import {
  DESCRIPTION as READ_DESCRIPTION,
  FILE_PATH_DESCRIPTION,
  LIMIT_DESCRIPTION,
  OFFSET_DESCRIPTION,
  PATH_ALIAS_DESCRIPTION,
  PROMPT,
} from './readFilePrompt.js'

const DEFAULT_MAX_READ_SIZE_BYTES = 256 * 1024

export type ReadFileToolInput = {
  file_path?: string
  path?: string
  offset?: number
  limit?: number
}

export type ReadToolOutput = {
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

export const readFileTool: Tool<ReadFileToolInput, ReadToolOutput> = buildTool({
  name: 'Read',
  description: READ_DESCRIPTION,
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

    const absolutePath = toAbsoluteToolPath(filePath)
    const fileStat = await stat(absolutePath)
    if (
      input.limit === undefined &&
      fileStat.size > DEFAULT_MAX_READ_SIZE_BYTES
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
    const output: ReadToolOutput = {
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
