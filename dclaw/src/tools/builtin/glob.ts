import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { ToolResult } from '../../types/tool.js'
import type { Tool } from '../types.js'
import { fallbackGlob } from './fileSearch.js'
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
  truncated: boolean
  durationMs: number
}

export const globTool: Tool<GlobToolInput, GlobToolOutput> = {
  name: 'Glob',
  description: 'Fast file pattern matching tool.',
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
    const args = ['--files', '-g', input.pattern, input.path ? toAbsoluteToolPath(input.path) : '.']

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
          truncated,
          durationMs: Date.now() - start,
        },
        summary: truncated
          ? `Found ${limitedFilenames.length}+ file(s)`
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
            truncated,
            durationMs: Date.now() - start,
          },
          summary: truncated
            ? `Found ${limitedFilenames.length}+ file(s) (node fallback)`
            : `Found ${limitedFilenames.length} file(s) (node fallback)`,
        }
      }

      if (String(commandError.code) === '1') {
        return {
          ok: true,
          output: {
            filenames: [],
            numFiles: 0,
            truncated: false,
            durationMs: Date.now() - start,
          },
          summary: 'Found 0 file(s)',
        }
      }

      throw error
    }
  },
}
