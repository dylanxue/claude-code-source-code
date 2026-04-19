import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './globPrompt.js'
import {
  DEFAULT_EXCLUDED_SEARCH_DIRECTORIES,
  fallbackGlob,
  shouldApplyDefaultSearchExclusions,
} from './fileSearch.js'
import {
  isAbsoluteToolPath,
  toAbsoluteToolPath,
  toDisplayPath,
} from './pathUtils.js'

const execFileAsync = promisify(execFile)
const DEFAULT_GLOB_LIMIT = 100

export type GlobToolInput = {
  pattern: string
  path?: string
}

export type GlobToolOutput = {
  filenames: string[]
  numFiles: number
  totalFiles: number
  truncated: boolean
  appliedLimit?: number
  searchRoot: string
  engine: 'ripgrep' | 'node-fallback'
  durationMs: number
}

function getSearchRoot(path: string | undefined, cwd: string): string {
  if (!path) {
    return '.'
  }

  const absolutePath = toAbsoluteToolPath(path)
  if (resolve(absolutePath) === resolve(cwd)) {
    return '.'
  }

  return toDisplayPath(absolutePath, cwd)
}

export const globTool: Tool<GlobToolInput, GlobToolOutput> = buildTool({
  name: 'Glob',
  description: DESCRIPTION,
  maxResultSizeChars: 100_000,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match, for example **/*.ts.',
      },
      path: {
        type: 'string',
        description: 'Optional absolute directory path to search within.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      filenames: {
        type: 'array',
        items: { type: 'string' },
      },
      numFiles: { type: 'integer' },
      totalFiles: { type: 'integer' },
      truncated: { type: 'boolean' },
      appliedLimit: { type: 'integer' },
      searchRoot: { type: 'string' },
      engine: {
        type: 'string',
        enum: ['ripgrep', 'node-fallback'],
      },
      durationMs: { type: 'integer' },
    },
    required: [
      'filenames',
      'numFiles',
      'totalFiles',
      'truncated',
      'searchRoot',
      'engine',
      'durationMs',
    ],
    additionalProperties: false,
  },
  async validate(input) {
    if (!input.pattern || input.pattern.trim().length === 0) {
      return {
        ok: false,
        error: 'Glob requires a non-empty pattern',
      }
    }

    if (input.path) {
      if (!isAbsoluteToolPath(input.path)) {
        return {
          ok: false,
          error: 'Glob path must be absolute when provided',
        }
      }

      const pathStat = await stat(toAbsoluteToolPath(input.path))
      if (!pathStat.isDirectory()) {
        return {
          ok: false,
          error: 'Glob path must point to a directory',
        }
      }
    }

    return { ok: true }
  },
  isReadOnly() {
    return true
  },
  async call(input, context): Promise<ToolResult<GlobToolOutput>> {
    const start = Date.now()
    const searchRoot = getSearchRoot(input.path, context.cwd)
    const args = ['--files']

    if (shouldApplyDefaultSearchExclusions(input.path)) {
      for (const directory of DEFAULT_EXCLUDED_SEARCH_DIRECTORIES) {
        args.push('--glob', `!${directory}`)
      }
    }

    args.push('-g', input.pattern, input.path ? toAbsoluteToolPath(input.path) : '.')

    try {
      const { stdout } = await execFileAsync('rg', args, {
        cwd: context.cwd,
        maxBuffer: 10 * 1024 * 1024,
      })
      const filenames = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => toDisplayPath(line, context.cwd))
        .sort()
      const truncated = filenames.length > DEFAULT_GLOB_LIMIT
      const limitedFilenames = filenames.slice(0, DEFAULT_GLOB_LIMIT)

      return {
        ok: true,
        output: {
          filenames: limitedFilenames,
          numFiles: limitedFilenames.length,
          totalFiles: filenames.length,
          truncated,
          appliedLimit: truncated ? DEFAULT_GLOB_LIMIT : undefined,
          searchRoot,
          engine: 'ripgrep',
          durationMs: Date.now() - start,
        },
        summary: truncated
          ? `Found ${limitedFilenames.length} of ${filenames.length} file(s)`
          : `Found ${limitedFilenames.length} file(s)`,
      }
    } catch (error) {
      const commandError = error as NodeJS.ErrnoException & { stdout?: string }
      if (commandError.code === 'ENOENT') {
        const filenames = (
          await fallbackGlob({
            cwd: context.cwd,
            targetPath: input.path,
            pattern: input.pattern,
          })
        ).sort()
        const truncated = filenames.length > DEFAULT_GLOB_LIMIT
        const limitedFilenames = filenames.slice(0, DEFAULT_GLOB_LIMIT)

        return {
          ok: true,
          output: {
            filenames: limitedFilenames,
            numFiles: limitedFilenames.length,
            totalFiles: filenames.length,
            truncated,
            appliedLimit: truncated ? DEFAULT_GLOB_LIMIT : undefined,
            searchRoot,
            engine: 'node-fallback',
            durationMs: Date.now() - start,
          },
          summary: truncated
            ? `Found ${limitedFilenames.length} of ${filenames.length} file(s) (node fallback)`
            : `Found ${limitedFilenames.length} file(s) (node fallback)`,
        }
      }

      if (String(commandError.code) === '1') {
        return {
          ok: true,
          output: {
            filenames: [],
            numFiles: 0,
            totalFiles: 0,
            truncated: false,
            searchRoot,
            engine: 'ripgrep',
            durationMs: Date.now() - start,
          },
          summary: 'Found 0 file(s)',
        }
      }

      throw error
    }
  },
})
