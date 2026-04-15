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

export const editTool: Tool<EditToolInput, EditToolOutput> = {
  name: 'Edit',
  description: 'Edit a file in place.',
  validate: async (input, context) => {
    if (!input.file_path || input.file_path.trim().length === 0) {
      return {
        ok: false,
        error: 'Edit requires a non-empty file_path',
      }
    }

    if (!isAbsoluteToolPath(input.file_path)) {
      return {
        ok: false,
        error: 'Edit requires file_path to be absolute',
      }
    }

    if (input.old_string === input.new_string) {
      return {
        ok: false,
        error: 'Edit requires old_string and new_string to differ',
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
          error: 'File has not been fully read yet. Use Read first before Edit.',
        }
      }

      if (
        Math.floor(fileStat.mtimeMs) > readState.timestamp &&
        !contentsMatchReadState(currentContent, readState.content)
      ) {
        return {
          ok: false,
          error: 'File has been modified since it was read. Use Read again before Edit.',
        }
      }

      if (input.old_string === '') {
        if (currentContent.trim() !== '') {
          return {
            ok: false,
            error:
              'Cannot create new file content with Edit because the file already exists and is not empty.',
          }
        }

        return { ok: true }
      }

      const matches = countMatches(currentContent, input.old_string)
      if (matches === 0) {
        return {
          ok: false,
          error: `String to replace not found in file.\nString: ${input.old_string}`,
        }
      }

      if (matches > 1 && !input.replace_all) {
        return {
          ok: false,
          error:
            `Found ${matches} matches of the string to replace, but replace_all is false. ` +
            'Set replace_all to true or provide more context to identify a single occurrence.',
        }
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code === 'ENOENT' && input.old_string === '') {
        return { ok: true }
      }
      if (fileError.code === 'ENOENT') {
        return {
          ok: false,
          error: 'File does not exist. Use Write to create a file, or Edit with old_string="" only for new file creation.',
        }
      }
      throw error
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<EditToolOutput>> {
    const absolutePath = toAbsoluteToolPath(input.file_path)

    let currentContent = ''
    try {
      currentContent = await readFile(absolutePath, 'utf8')
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code !== 'ENOENT') {
        throw error
      }
    }

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

    return {
      ok: true,
      output: {
        filePath: absolutePath,
        oldString: input.old_string,
        newString: input.new_string,
        originalFile: currentContent,
        structuredPatch,
        userModified: false,
        replaceAll: input.replace_all ?? false,
        replaced: replacement.replaced,
        content: replacement.content,
        ...(gitDiff ? { gitDiff } : {}),
      },
      summary: `Edited ${absolutePath}`,
    }
  },
}
