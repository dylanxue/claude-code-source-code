import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, matchesGlob, relative, resolve } from 'node:path'

type WalkFilesInput = {
  cwd: string
  targetPath?: string
  hidden?: boolean
}

export type SearchFile = {
  absolutePath: string
  relativePath: string
}

export const DEFAULT_EXCLUDED_SEARCH_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
] as const

export function shouldApplyDefaultSearchExclusions(
  targetPath?: string,
): boolean {
  if (!targetPath) {
    return true
  }

  const segments = resolve(targetPath)
    .split(/[\\/]+/)
    .filter(Boolean)

  return !segments.some(segment =>
    DEFAULT_EXCLUDED_SEARCH_DIRECTORIES.includes(
      segment as (typeof DEFAULT_EXCLUDED_SEARCH_DIRECTORIES)[number],
    ),
  )
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

function shouldSkipDirectoryName(name: string, isRoot: boolean): boolean {
  if (isRoot) {
    return false
  }

  return DEFAULT_EXCLUDED_SEARCH_DIRECTORIES.includes(
    name as (typeof DEFAULT_EXCLUDED_SEARCH_DIRECTORIES)[number],
  )
}

async function walkDirectory(
  cwd: string,
  directoryPath: string,
  hidden: boolean,
  files: SearchFile[],
  isRoot: boolean = false,
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!hidden && isHiddenName(entry.name)) {
      continue
    }

    const absolutePath = resolve(directoryPath, entry.name)
    if (entry.isDirectory()) {
      if (shouldSkipDirectoryName(entry.name, false)) {
        continue
      }
      await walkDirectory(cwd, absolutePath, hidden, files, false)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    files.push({
      absolutePath,
      relativePath: relative(cwd, absolutePath),
    })
  }
}

export async function collectFiles(input: WalkFilesInput): Promise<SearchFile[]> {
  const absoluteTargetPath = resolve(input.cwd, input.targetPath || '.')
  const targetStat = await stat(absoluteTargetPath)
  const hidden = input.hidden ?? false

  if (targetStat.isFile()) {
    const targetName = basename(absoluteTargetPath)
    if (!hidden && isHiddenName(targetName)) {
      return []
    }

    return [
      {
        absolutePath: absoluteTargetPath,
        relativePath: relative(input.cwd, absoluteTargetPath),
      },
    ]
  }

  const files: SearchFile[] = []
  await walkDirectory(input.cwd, absoluteTargetPath, hidden, files, true)
  return files
}

export async function fallbackGlob(input: WalkFilesInput & {
  pattern?: string
}): Promise<string[]> {
  const files = await collectFiles(input)

  return files
    .map(file => file.relativePath)
    .filter(path => {
      if (!input.pattern) {
        return true
      }
      return (
        matchesFileGlob(path, input.pattern)
      )
    })
}

export function matchesFileGlob(path: string, pattern?: string): boolean {
  if (!pattern) {
    return true
  }

  return matchesGlob(path, pattern) || matchesGlob(basename(path), pattern)
}

export type FallbackGrepMatch = {
  path: string
  line: number
  text: string
}

function createLineMatcher(
  pattern: string,
  caseInsensitive: boolean,
): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, caseInsensitive ? 'i' : undefined)
    return (line: string) => regex.test(line)
  } catch {
    if (caseInsensitive) {
      const lowerPattern = pattern.toLowerCase()
      return (line: string) => line.toLowerCase().includes(lowerPattern)
    }

    return (line: string) => line.includes(pattern)
  }
}

export async function fallbackGrep(input: WalkFilesInput & {
  pattern: string
  filePattern?: string
  caseInsensitive?: boolean
}): Promise<FallbackGrepMatch[]> {
  const matches: FallbackGrepMatch[] = []
  const files = (await collectFiles(input)).filter(file =>
    matchesFileGlob(file.relativePath, input.filePattern),
  )
  const matchLine = createLineMatcher(
    input.pattern,
    input.caseInsensitive ?? false,
  )

  for (const file of files) {
    let text: string
    try {
      text = await readFile(file.absolutePath, 'utf8')
    } catch {
      continue
    }

    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (!matchLine(line)) {
        continue
      }

      matches.push({
        path: file.relativePath,
        line: index + 1,
        text: line,
      })
    }
  }

  return matches
}
