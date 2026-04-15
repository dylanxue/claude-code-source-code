import { readFile, stat } from 'node:fs/promises'
import type { ToolResult } from '../../types/tool.js'
import type { Tool } from '../types.js'
import { isAbsoluteToolPath, toAbsoluteToolPath } from './pathUtils.js'

export type ReadFileToolInput = {
  file_path: string
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
    totalLines: number
  }
  isPartial: boolean
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

export const readFileTool: Tool<ReadFileToolInput, ReadToolOutput> = {
  name: 'Read',
  description: 'Read a file from the local filesystem.',
  async validate(input) {
    if (!input.file_path || input.file_path.trim().length === 0) {
      return {
        ok: false,
        error: 'Read requires a non-empty file_path',
      }
    }

    if (!isAbsoluteToolPath(input.file_path)) {
      return {
        ok: false,
        error: 'Read requires file_path to be absolute',
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
      const fileStat = await stat(toAbsoluteToolPath(input.file_path))
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
          error: `File does not exist: ${input.file_path}`,
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
    const absolutePath = toAbsoluteToolPath(input.file_path)
    const text = await readFile(absolutePath, 'utf8')
    const fileStat = await stat(absolutePath)
    const lines = splitLogicalLines(text)
    const startLine = input.offset ?? 1
    const limit = input.limit
    const startIndex = startLine - 1
    const selectedLines =
      limit === undefined
        ? lines.slice(startIndex)
        : lines.slice(startIndex, startIndex + limit)
    const output: ReadToolOutput = {
      type: 'text',
      file: {
        filePath: absolutePath,
        content: selectedLines.join('\n'),
        numLines: selectedLines.length,
        startLine,
        totalLines: lines.length,
      },
      isPartial: startLine > 1 || limit !== undefined,
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
}
