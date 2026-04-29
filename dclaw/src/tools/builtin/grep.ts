import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './grepPrompt.js'
import {
  DEFAULT_EXCLUDED_SEARCH_DIRECTORIES,
  fallbackGrep,
  shouldApplyDefaultSearchExclusions,
  type FallbackGrepMatch,
} from './fileSearch.js'
import {
  isAbsoluteToolPath,
  toAbsoluteToolPath,
  toDisplayPath,
} from './pathUtils.js'

const execFileAsync = promisify(execFile)

export type GrepMatch = {
  path: string
  line: number
  text: string
}

export type GrepToolInput = {
  pattern: string
  path?: string
  glob?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  '-A'?: number
  '-B'?: number
  '-C'?: number
  context?: number
  '-n'?: boolean | string
  head_limit?: number
  offset?: number
  type?: string
  multiline?: boolean | string
  '-i'?: boolean | string
}

export type GrepToolOutput = {
  mode: 'content' | 'files_with_matches' | 'count'
  numFiles: number
  totalFiles: number
  filenames: string[]
  searchRoot: string
  engine: 'ripgrep' | 'node-fallback'
  durationMs: number
  content?: string
  numLines?: number
  totalLines?: number
  numMatches?: number
  totalMatches?: number
  appliedLimit?: number
  appliedOffset?: number
  truncated: boolean
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

function isTruthy(value: unknown): boolean {
  return value === true || value === 'true'
}

function parseGrepLine(line: string): GrepMatch | null {
  const firstSeparator = line.indexOf(':')
  if (firstSeparator === -1) {
    return null
  }

  const secondSeparator = line.indexOf(':', firstSeparator + 1)
  if (secondSeparator === -1) {
    return null
  }

  const path = line.slice(0, firstSeparator)
  const lineNumber = Number(line.slice(firstSeparator + 1, secondSeparator))
  const text = line.slice(secondSeparator + 1)

  if (!path || Number.isNaN(lineNumber)) {
    return null
  }

  return {
    path,
    line: lineNumber,
    text,
  }
}

function applySlice<T>(
  items: T[],
  limit?: number,
  offset: number = 0,
): { items: T[]; appliedLimit?: number; appliedOffset?: number } {
  if (limit === 0) {
    return {
      items: items.slice(offset),
      appliedOffset: offset > 0 ? offset : undefined,
    }
  }

  const effectiveLimit = limit ?? 250
  const sliced =
    effectiveLimit === undefined
      ? items.slice(offset)
      : items.slice(offset, offset + effectiveLimit)
  const wasTruncated =
    effectiveLimit !== undefined && items.length - offset > effectiveLimit

  return {
    items: sliced,
    appliedLimit: wasTruncated ? effectiveLimit : undefined,
    appliedOffset: offset > 0 ? offset : undefined,
  }
}

function uniqueValues(items: string[]): string[] {
  return [...new Set(items)]
}

function shapeGrepOutput(
  stdout: string,
  mode: GrepToolOutput['mode'],
  cwd: string,
  searchRoot: string,
  engine: GrepToolOutput['engine'],
  showLineNumbers: boolean,
  limit?: number,
  offset: number = 0,
  durationMs: number = 0,
): GrepToolOutput {
  const lines = stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)

  if (mode === 'files_with_matches') {
    const totalFiles = lines.length
    const sliced = applySlice(
      lines.map(line => toDisplayPath(line, cwd)),
      limit,
      offset,
    )
    return {
      mode,
      numFiles: sliced.items.length,
      totalFiles,
      filenames: sliced.items,
      searchRoot,
      engine,
      durationMs,
      appliedLimit: sliced.appliedLimit,
      appliedOffset: sliced.appliedOffset,
      truncated: sliced.items.length < totalFiles,
    }
  }

  if (mode === 'count') {
    const normalizedLines = lines.map(line => {
      const separator = line.indexOf(':')
      if (separator === -1) {
        return line
      }

      const rawPath = line.slice(0, separator)
      return `${toDisplayPath(rawPath, cwd)}:${line.slice(separator + 1)}`
    })
    const sliced = applySlice(normalizedLines, limit, offset)
    const filenames = sliced.items
      .map(line => line.split(':', 1)[0] ?? '')
      .filter(Boolean)
    const totalFiles = normalizedLines.length
    const numMatches = sliced.items.reduce((sum, line) => {
      const count = Number(line.split(':').at(-1) ?? '0')
      return sum + (Number.isNaN(count) ? 0 : count)
    }, 0)
    const totalMatches = normalizedLines.reduce((sum, line) => {
      const count = Number(line.split(':').at(-1) ?? '0')
      return sum + (Number.isNaN(count) ? 0 : count)
    }, 0)

    return {
      mode,
      numFiles: filenames.length,
      totalFiles,
      filenames,
      searchRoot,
      engine,
      durationMs,
      content: sliced.items.join('\n'),
      numMatches,
      totalMatches,
      appliedLimit: sliced.appliedLimit,
      appliedOffset: sliced.appliedOffset,
      truncated: sliced.items.length < normalizedLines.length,
    }
  }

  const normalizedLines = lines.map(line => {
    const match = parseGrepLine(line)
    if (!match && !showLineNumbers) {
      const separator = line.indexOf(':')
      if (separator !== -1) {
        const rawPath = line.slice(0, separator)
        return `${toDisplayPath(rawPath, cwd)}:${line.slice(separator + 1)}`
      }
    }

    if (!match) {
      return line
    }

    const displayPath = toDisplayPath(match.path, cwd)
    return showLineNumbers
      ? `${displayPath}:${match.line}:${match.text}`
      : `${displayPath}:${match.text}`
  })
  const sliced = applySlice(normalizedLines, limit, offset)
  const allMatches = normalizedLines
    .map(line => {
      if (!showLineNumbers) {
        const separator = line.indexOf(':')
        return separator === -1 ? null : line.slice(0, separator)
      }
      return parseGrepLine(line)?.path ?? null
    })
    .filter((match): match is string => match !== null)
  const matches = sliced.items
    .map(line => {
      if (!showLineNumbers) {
        const separator = line.indexOf(':')
        return separator === -1 ? null : line.slice(0, separator)
      }
      return parseGrepLine(line)?.path ?? null
    })
    .filter((match): match is string => match !== null)
  const filenames = uniqueValues(matches)
  const totalFiles = uniqueValues(allMatches).length

  return {
    mode,
    numFiles: filenames.length,
    totalFiles,
    filenames,
    searchRoot,
    engine,
    durationMs,
    content: sliced.items.join('\n'),
    numLines: sliced.items.length,
    totalLines: normalizedLines.length,
    appliedLimit: sliced.appliedLimit,
    appliedOffset: sliced.appliedOffset,
    truncated: sliced.items.length < normalizedLines.length,
  }
}

function shapeFallbackGrepOutput(
  matches: FallbackGrepMatch[],
  mode: GrepToolOutput['mode'],
  searchRoot: string,
  showLineNumbers: boolean,
  limit?: number,
  offset: number = 0,
  durationMs: number = 0,
): GrepToolOutput {
  if (mode === 'files_with_matches') {
    const filenames = uniqueValues(matches.map(match => match.path))
    const totalFiles = filenames.length
    const sliced = applySlice(filenames, limit, offset)
    return {
      mode,
      numFiles: sliced.items.length,
      totalFiles,
      filenames: sliced.items,
      searchRoot,
      engine: 'node-fallback',
      durationMs,
      appliedLimit: sliced.appliedLimit,
      appliedOffset: sliced.appliedOffset,
      truncated: sliced.items.length < totalFiles,
    }
  }

  if (mode === 'count') {
    const counts = new Map<string, number>()
    for (const match of matches) {
      counts.set(match.path, (counts.get(match.path) ?? 0) + 1)
    }

    const lines = [...counts.entries()].map(([path, count]) => `${path}:${count}`)
    const sliced = applySlice(lines, limit, offset)
    const filenames = sliced.items
      .map(line => line.split(':', 1)[0] ?? '')
      .filter(Boolean)
    const totalFiles = lines.length
    const numMatches = sliced.items.reduce((sum, line) => {
      const count = Number(line.split(':').at(-1) ?? '0')
      return sum + (Number.isNaN(count) ? 0 : count)
    }, 0)
    const totalMatches = lines.reduce((sum, line) => {
      const count = Number(line.split(':').at(-1) ?? '0')
      return sum + (Number.isNaN(count) ? 0 : count)
    }, 0)

    return {
      mode,
      numFiles: filenames.length,
      totalFiles,
      filenames,
      searchRoot,
      engine: 'node-fallback',
      durationMs,
      content: sliced.items.join('\n'),
      numMatches,
      totalMatches,
      appliedLimit: sliced.appliedLimit,
      appliedOffset: sliced.appliedOffset,
      truncated: sliced.items.length < lines.length,
    }
  }

  const sliced = applySlice(matches, limit, offset)
  const filenames = uniqueValues(sliced.items.map(match => match.path))
  const totalFiles = uniqueValues(matches.map(match => match.path)).length

  return {
    mode,
    numFiles: filenames.length,
    totalFiles,
    filenames,
    searchRoot,
    engine: 'node-fallback',
    durationMs,
    content: sliced.items
      .map(match =>
        showLineNumbers
          ? `${match.path}:${match.line}:${match.text}`
          : `${match.path}:${match.text}`,
      )
      .join('\n'),
    numLines: sliced.items.length,
    totalLines: matches.length,
    appliedLimit: sliced.appliedLimit,
    appliedOffset: sliced.appliedOffset,
    truncated: sliced.items.length < matches.length,
  }
}

export const grepTool: Tool<GrepToolInput, GrepToolOutput> = buildTool({
  name: 'Grep',
  description: DESCRIPTION,
  maxResultSizeChars: 20_000,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'Optional absolute file or directory path to search within.',
      },
      glob: {
        type: 'string',
        description: 'Optional glob filter to limit searched files.',
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'Choose matched content, matching filenames, or per-file counts.',
      },
      '-A': {
        type: 'integer',
        minimum: 0,
        description: 'Show this many lines of trailing context after each match.',
      },
      '-B': {
        type: 'integer',
        minimum: 0,
        description: 'Show this many lines of leading context before each match.',
      },
      '-C': {
        type: 'integer',
        minimum: 0,
        description: 'Show this many lines of context before and after each match.',
      },
      context: {
        type: 'integer',
        minimum: 0,
        description: 'Claude Code style alias for symmetric match context.',
      },
      '-n': {
        anyOf: [{ type: 'boolean' }, { type: 'string' }],
        description: 'Whether to include line numbers in content output.',
      },
      head_limit: {
        type: 'integer',
        minimum: 0,
        description: 'Maximum number of output rows to return. Use 0 for no explicit limit.',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Skip this many output rows before returning matches.',
      },
      type: {
        type: 'string',
        description: 'Optional ripgrep file type filter, for example ts or md.',
      },
      multiline: {
        anyOf: [{ type: 'boolean' }, { type: 'string' }],
        description: 'Enable multiline matching.',
      },
      '-i': {
        anyOf: [{ type: 'boolean' }, { type: 'string' }],
        description: 'Enable case-insensitive matching.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
      },
      numFiles: { type: 'integer' },
      totalFiles: { type: 'integer' },
      filenames: {
        type: 'array',
        items: { type: 'string' },
      },
      searchRoot: { type: 'string' },
      engine: {
        type: 'string',
        enum: ['ripgrep', 'node-fallback'],
      },
      durationMs: { type: 'integer' },
      content: { type: 'string' },
      numLines: { type: 'integer' },
      totalLines: { type: 'integer' },
      numMatches: { type: 'integer' },
      totalMatches: { type: 'integer' },
      appliedLimit: { type: 'integer' },
      appliedOffset: { type: 'integer' },
      truncated: { type: 'boolean' },
    },
    required: [
      'mode',
      'numFiles',
      'totalFiles',
      'filenames',
      'searchRoot',
      'engine',
      'durationMs',
      'truncated',
    ],
    additionalProperties: false,
  },
  async validate(input) {
    if (!input.pattern || input.pattern.trim().length === 0) {
      return {
        ok: false,
        error: 'Grep requires a non-empty pattern',
      }
    }

    if (input.path) {
      if (!isAbsoluteToolPath(input.path)) {
        return {
          ok: false,
          error: 'Grep path must be absolute when provided',
        }
      }

      const absolutePath = toAbsoluteToolPath(input.path)
      try {
        await stat(absolutePath)
      } catch (error) {
        const fileError = error as NodeJS.ErrnoException
        if (fileError.code === 'ENOENT') {
          return {
            ok: false,
            error: `Grep path does not exist: ${absolutePath}`,
          }
        }
        throw error
      }
    }

    if (
      input.head_limit !== undefined &&
      (!Number.isInteger(input.head_limit) || input.head_limit < 0)
    ) {
      return {
        ok: false,
        error: 'Grep head_limit must be an integer greater than or equal to 0',
      }
    }

    if (
      input.offset !== undefined &&
      (!Number.isInteger(input.offset) || input.offset < 0)
    ) {
      return {
        ok: false,
        error: 'Grep offset must be an integer greater than or equal to 0',
      }
    }

    return { ok: true }
  },
  isReadOnly() {
    return true
  },
  async call(input, context): Promise<ToolResult<GrepToolOutput>> {
    const start = Date.now()
    const mode = input.output_mode ?? 'files_with_matches'
    const limit = input.head_limit
    const offset = input.offset ?? 0
    const pathArg = input.path ? toAbsoluteToolPath(input.path) : '.'
    const searchRoot = getSearchRoot(input.path, context.cwd)
    const args = ['--color', 'never']
    const showLineNumbers = mode === 'content' && input['-n'] !== false

    if (shouldApplyDefaultSearchExclusions(input.path)) {
      for (const directory of DEFAULT_EXCLUDED_SEARCH_DIRECTORIES) {
        args.push('--glob', `!${directory}`)
      }
    }

    if (isTruthy(input['-i'])) {
      args.push('-i')
    }
    if (input.glob) {
      args.push('--glob', input.glob)
    }
    if (input.type) {
      args.push('--type', input.type)
    }
    if (isTruthy(input.multiline)) {
      args.push('-U', '--multiline-dotall')
    }
    if (mode === 'content') {
      if (showLineNumbers) {
        args.push('--line-number')
      }
      args.push('--no-heading', '--with-filename')
      if (input.context !== undefined) {
        args.push('-C', String(input.context))
      } else if (input['-C'] !== undefined) {
        args.push('-C', String(input['-C']))
      } else {
        if (input['-A'] !== undefined) {
          args.push('-A', String(input['-A']))
        }
        if (input['-B'] !== undefined) {
          args.push('-B', String(input['-B']))
        }
      }
    }
    if (mode === 'files_with_matches') {
      args.push('--files-with-matches')
    }
    if (mode === 'count') {
      args.push('--count')
    }

    args.push(input.pattern, pathArg)

    try {
      const { stdout } = await execFileAsync('rg', args, {
        cwd: context.cwd,
        maxBuffer: 10 * 1024 * 1024,
      })
      const durationMs = Date.now() - start

      const output = shapeGrepOutput(
        stdout,
        mode,
        context.cwd,
        searchRoot,
        'ripgrep',
        showLineNumbers,
        limit,
        offset,
        durationMs,
      )
      return {
        ok: true,
        output,
        summary: `Found ${output.numFiles} file(s)`,
      }
    } catch (error) {
      const commandError = error as NodeJS.ErrnoException & { stdout?: string }
      if (commandError.code === 'ENOENT') {
        const matches = await fallbackGrep({
          cwd: context.cwd,
          targetPath: input.path,
          pattern: input.pattern,
          filePattern: input.glob,
          caseInsensitive: isTruthy(input['-i']),
        })
        const durationMs = Date.now() - start
        const output = shapeFallbackGrepOutput(
          matches,
          mode,
          searchRoot,
          showLineNumbers,
          limit,
          offset,
          durationMs,
        )
        return {
          ok: true,
          output,
          summary: `Found ${output.numFiles} file(s) (node fallback)`,
        }
      }

      if (String(commandError.code) === '1') {
        return {
          ok: true,
          output: {
            mode,
            numFiles: 0,
            totalFiles: 0,
            filenames: [],
            searchRoot,
            engine: 'ripgrep',
            durationMs: Date.now() - start,
            truncated: false,
            appliedOffset: offset > 0 ? offset : undefined,
          },
          summary: 'Found 0 match(es)',
        }
      }

      throw error
    }
  },
})
