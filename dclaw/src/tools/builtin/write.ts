import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ToolResult } from '../../types/tool.js'
import type { Tool } from '../types.js'
import { isAbsoluteToolPath, toAbsoluteToolPath } from './pathUtils.js'
import {
  createStructuredPatch,
  type StructuredPatchHunk,
} from './structuredPatch.js'
import {
  fetchSingleFileGitDiff,
  type ToolUseGitDiff,
} from './gitDiff.js'

export type WriteToolInput = {
  file_path: string
  content: string
}

export type WriteToolOutput = {
  type: 'create' | 'update'
  filePath: string
  content: string
  originalFile: string | null
  structuredPatch: StructuredPatchHunk[]
  gitDiff?: ToolUseGitDiff
}

function contentsMatchReadState(
  currentContent: string,
  readContent: string | undefined,
): boolean {
  return readContent !== undefined && currentContent === readContent
}

export const writeTool: Tool<WriteToolInput, WriteToolOutput> = {
  name: 'Write',
  description: 'Write a file to the local filesystem.',
  validate: async (input, context) => {
    if (!input.file_path || input.file_path.trim().length === 0) {
      return {
        ok: false,
        error: 'Write requires a non-empty file_path',
      }
    }

    if (!isAbsoluteToolPath(input.file_path)) {
      return {
        ok: false,
        error: 'Write requires file_path to be absolute',
      }
    }

    const absolutePath = toAbsoluteToolPath(input.file_path)

    try {
      const currentContent = await readFile(absolutePath, 'utf8')
      const fileStat = await stat(absolutePath)
      const readState = context.readState.get(absolutePath)

      if (!readState || readState.isPartialView) {
        return {
          ok: false,
          error: 'File has not been fully read yet. Use Read first before Write.',
        }
      }

      if (
        Math.floor(fileStat.mtimeMs) > readState.timestamp &&
        !contentsMatchReadState(currentContent, readState.content)
      ) {
        return {
          ok: false,
          error: 'File has been modified since it was read. Use Read again before Write.',
        }
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code !== 'ENOENT') {
        throw error
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<WriteToolOutput>> {
    const absolutePath = toAbsoluteToolPath(input.file_path)

    let originalFile: string | null = null
    let type: 'create' | 'update' = 'create'

    try {
      originalFile = await readFile(absolutePath, 'utf8')
      type = 'update'
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code !== 'ENOENT') {
        throw error
      }
    }

    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, input.content, 'utf8')

    const fileStat = await stat(absolutePath)
    context.readState.set(absolutePath, {
      content: input.content,
      timestamp: Math.floor(fileStat.mtimeMs),
      isPartialView: false,
      offset: undefined,
      limit: undefined,
    })
    const structuredPatch =
      originalFile === null
        ? []
        : createStructuredPatch(originalFile, input.content)
    const gitDiff = await fetchSingleFileGitDiff(
      absolutePath,
      originalFile,
      input.content,
    )

    return {
      ok: true,
      output: {
        type,
        filePath: absolutePath,
        content: input.content,
        originalFile,
        structuredPatch,
        ...(gitDiff ? { gitDiff } : {}),
      },
      summary: `${type === 'create' ? 'Created' : 'Updated'} ${absolutePath}`,
    }
  },
}
