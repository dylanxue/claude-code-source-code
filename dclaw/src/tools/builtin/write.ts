import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
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
  type: 'create' | 'update' | 'noop'
  filePath: string
  content: string
  originalFile: string | null
  structuredPatch: StructuredPatchHunk[]
  userModified: boolean
  didWrite: boolean
  gitDiff?: ToolUseGitDiff
}

function contentsMatchReadState(
  currentContent: string,
  readContent: string | undefined,
): boolean {
  return readContent !== undefined && currentContent === readContent
}

function wasUserModifiedSinceRead(
  timestamp: number | undefined,
  readTimestamp: number | undefined,
): boolean {
  return (
    timestamp !== undefined &&
    readTimestamp !== undefined &&
    timestamp > readTimestamp
  )
}

type PreparedWriteState = {
  absolutePath: string
  originalFile: string | null
  currentTimestamp?: number
  readStateTimestamp?: number
  type: 'create' | 'update' | 'noop'
}

async function prepareWriteState(
  input: WriteToolInput,
  context: ToolContext,
): Promise<PreparedWriteState> {
  if (!input.file_path || input.file_path.trim().length === 0) {
    throw new Error('Write requires a non-empty file_path')
  }

  if (!isAbsoluteToolPath(input.file_path)) {
    throw new Error('Write requires file_path to be absolute')
  }

  const absolutePath = toAbsoluteToolPath(input.file_path)

  try {
    const currentContent = await readFile(absolutePath, 'utf8')
    const fileStat = await stat(absolutePath)
    const currentTimestamp = Math.floor(fileStat.mtimeMs)
    const readState = context.readState.get(absolutePath)

    if (!readState || readState.isPartialView) {
      throw new Error('File has not been fully read yet. Use Read first before Write.')
    }

    if (
      currentTimestamp > readState.timestamp &&
      !contentsMatchReadState(currentContent, readState.content)
    ) {
      throw new Error(
        'File has been modified since it was read. Use Read again before Write.',
      )
    }

    return {
      absolutePath,
      originalFile: currentContent,
      currentTimestamp,
      readStateTimestamp: readState.timestamp,
      type: currentContent === input.content ? 'noop' : 'update',
    }
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException
    if (fileError.code === 'ENOENT') {
      return {
        absolutePath,
        originalFile: null,
        type: 'create',
      }
    }

    throw error
  }
}

export const writeTool: Tool<WriteToolInput, WriteToolOutput> = buildTool({
  name: 'Write',
  description: 'Write a file to the local filesystem.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to create or overwrite.',
      },
      content: {
        type: 'string',
        description: 'Full file contents to write.',
      },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['create', 'update', 'noop'],
      },
      filePath: { type: 'string' },
      content: { type: 'string' },
      originalFile: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
      },
      structuredPatch: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            oldStart: { type: 'integer' },
            oldLines: { type: 'integer' },
            newStart: { type: 'integer' },
            newLines: { type: 'integer' },
            lines: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['oldStart', 'oldLines', 'newStart', 'newLines', 'lines'],
          additionalProperties: false,
        },
      },
      userModified: { type: 'boolean' },
      didWrite: { type: 'boolean' },
      gitDiff: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          status: {
            type: 'string',
            enum: ['modified', 'added'],
          },
          additions: { type: 'integer' },
          deletions: { type: 'integer' },
          changes: { type: 'integer' },
          patch: { type: 'string' },
        },
        required: [
          'filename',
          'status',
          'additions',
          'deletions',
          'changes',
          'patch',
        ],
        additionalProperties: false,
      },
    },
    required: [
      'type',
      'filePath',
      'content',
      'originalFile',
      'structuredPatch',
      'userModified',
      'didWrite',
    ],
    additionalProperties: false,
  },
  validate: async (input, context) => {
    try {
      await prepareWriteState(input, context)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<WriteToolOutput>> {
    const prepared = await prepareWriteState(input, context)
    const absolutePath = prepared.absolutePath
    const originalFile = prepared.originalFile
    const type = prepared.type
    const userModified = wasUserModifiedSinceRead(
      prepared.currentTimestamp,
      prepared.readStateTimestamp,
    )

    if (type !== 'noop') {
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, input.content, 'utf8')
    }

    const fileStat =
      type === 'noop' && prepared.currentTimestamp !== undefined
        ? { mtimeMs: prepared.currentTimestamp }
        : await stat(absolutePath)
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
    const gitDiff =
      type === 'noop'
        ? undefined
        : await fetchSingleFileGitDiff(
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
        userModified,
        didWrite: type !== 'noop',
        ...(gitDiff ? { gitDiff } : {}),
      },
      summary:
        type === 'create'
          ? `Created ${absolutePath}`
          : type === 'update'
            ? `Updated ${absolutePath}`
            : `No changes for ${absolutePath}`,
    }
  },
})
