import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { appendPlanSnapshotForFile } from '../../tasks/planSnapshots.js'
import { DESCRIPTION, PROMPT } from './editPrompt.js'
import { isAbsoluteToolPath, toAbsoluteToolPath } from './pathUtils.js'
import {
  createStructuredPatch,
  type StructuredPatchHunk,
} from './structuredPatch.js'
import {
  fetchSingleFileGitDiff,
  type ToolUseGitDiff,
} from './gitDiff.js'

export type EditToolInput = {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export type EditToolOutput = {
  filePath: string
  oldString: string
  newString: string
  originalFile: string
  structuredPatch: StructuredPatchHunk[]
  userModified: boolean
  didWrite: boolean
  replaceAll: boolean
  replaced: number
  content: string
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

type PreparedEditState = {
  absolutePath: string
  currentContent: string
  currentTimestamp?: number
  readStateTimestamp?: number
}

async function prepareEditState(
  input: EditToolInput,
  context: ToolContext,
): Promise<PreparedEditState> {
  if (!input.file_path || input.file_path.trim().length === 0) {
    throw new Error('Edit requires a non-empty file_path')
  }

  if (!isAbsoluteToolPath(input.file_path)) {
    throw new Error('Edit requires file_path to be absolute')
  }

  if (input.old_string === input.new_string) {
    throw new Error('Edit requires old_string and new_string to differ')
  }

  const absolutePath = toAbsoluteToolPath(input.file_path)

  try {
    const currentContent = await readFile(absolutePath, 'utf8')
    const fileStat = await stat(absolutePath)
    const currentTimestamp = Math.floor(fileStat.mtimeMs)
    const readState = context.readState.get(absolutePath)

    if (!readState || readState.isPartialView) {
      throw new Error('File has not been fully read yet. Use Read first before Edit.')
    }

    if (
      currentTimestamp > readState.timestamp &&
      !contentsMatchReadState(currentContent, readState.content)
    ) {
      throw new Error(
        'File has been modified since it was read. Use Read again before Edit.',
      )
    }

    if (input.old_string === '' && currentContent.trim() !== '') {
      throw new Error(
        'Cannot create new file content with Edit because the file already exists and is not empty.',
      )
    }

    const matches = countMatches(currentContent, input.old_string)
    if (input.old_string !== '' && matches === 0) {
      throw new Error(
        `String to replace not found in file.\nString: ${input.old_string}`,
      )
    }

    if (matches > 1 && !input.replace_all) {
      throw new Error(
        `Found ${matches} matches of the string to replace, but replace_all is false. ` +
          'Set replace_all to true or provide more context to identify a single occurrence.',
      )
    }

    return {
      absolutePath,
      currentContent,
      currentTimestamp,
      readStateTimestamp: readState.timestamp,
    }
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException
    if (fileError.code === 'ENOENT') {
      if (input.old_string === '') {
        return {
          absolutePath,
          currentContent: '',
        }
      }

      throw new Error(
        'File does not exist. Use Write to create a file, or Edit with old_string="" only for new file creation.',
      )
    }

    throw error
  }
}

function countMatches(source: string, oldString: string): number {
  if (oldString.length === 0) {
    return 0
  }

  return source.split(oldString).length - 1
}

function replaceOnce(
  source: string,
  oldString: string,
  newString: string,
): { content: string; replaced: number } {
  const index = source.indexOf(oldString)
  if (index === -1) {
    return { content: source, replaced: 0 }
  }

  if (source.indexOf(oldString, index + oldString.length) !== -1) {
    throw new Error(
      'old_string appears multiple times. Use replace_all=true or provide more specific context.',
    )
  }

  return {
    content:
      source.slice(0, index) +
      newString +
      source.slice(index + oldString.length),
    replaced: 1,
  }
}

function replaceAll(
  source: string,
  oldString: string,
  newString: string,
): { content: string; replaced: number } {
  const parts = source.split(oldString)
  return {
    content: parts.join(newString),
    replaced: parts.length - 1,
  }
}

export const editTool: Tool<EditToolInput, EditToolOutput> = buildTool({
  name: 'Edit',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to edit.',
      },
      old_string: {
        type: 'string',
        description: 'Exact text to replace. Use an empty string only for creating a new empty file via Edit.',
      },
      new_string: {
        type: 'string',
        description: 'Replacement text to write into the file.',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all matches of old_string instead of requiring a single unique match.',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string' },
      oldString: { type: 'string' },
      newString: { type: 'string' },
      originalFile: { type: 'string' },
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
      replaceAll: { type: 'boolean' },
      replaced: { type: 'integer' },
      content: { type: 'string' },
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
      'filePath',
      'oldString',
      'newString',
      'originalFile',
      'structuredPatch',
      'userModified',
      'didWrite',
      'replaceAll',
      'replaced',
      'content',
    ],
    additionalProperties: false,
  },
  validate: async (input, context) => {
    try {
      await prepareEditState(input, context)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<EditToolOutput>> {
    const prepared = await prepareEditState(input, context)
    const absolutePath = prepared.absolutePath
    const currentContent = prepared.currentContent
    const currentTimestamp = prepared.currentTimestamp

    const replacement =
      input.old_string === ''
        ? { content: input.new_string, replaced: 1 }
        : input.replace_all
          ? replaceAll(currentContent, input.old_string, input.new_string)
          : replaceOnce(currentContent, input.old_string, input.new_string)

    if (replacement.replaced === 0) {
      throw new Error('old_string was not found in the target file')
    }

    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, replacement.content, 'utf8')

    const fileStat = await stat(absolutePath)
    const userModified = wasUserModifiedSinceRead(
      currentTimestamp,
      prepared.readStateTimestamp,
    )
    context.readState.set(absolutePath, {
      content: replacement.content,
      timestamp: Math.floor(fileStat.mtimeMs),
      isPartialView: false,
      offset: undefined,
      limit: undefined,
    })
    const structuredPatch = createStructuredPatch(
      currentContent,
      replacement.content,
    )
    const gitDiff = await fetchSingleFileGitDiff(
      absolutePath,
      currentContent,
      replacement.content,
    )
    if (
      context.sessionId &&
      context.planFilePath &&
      absolutePath === context.planFilePath
    ) {
      await appendPlanSnapshotForFile(
        context.sessionId,
        absolutePath,
        'edit-plan-file',
      )
    }

    return {
      ok: true,
      output: {
        filePath: absolutePath,
        oldString: input.old_string,
        newString: input.new_string,
        originalFile: currentContent,
        structuredPatch,
        userModified,
        didWrite: true,
        replaceAll: input.replace_all ?? false,
        replaced: replacement.replaced,
        content: replacement.content,
        ...(gitDiff ? { gitDiff } : {}),
      },
      summary: `Edited ${absolutePath}`,
    }
  },
})
