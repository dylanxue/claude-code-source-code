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

function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

async function walkDirectory(
  cwd: string,
  directoryPath: string,
  hidden: boolean,
  files: SearchFile[],
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!hidden && isHiddenName(entry.name)) {
      continue
    }

    const absolutePath = resolve(directoryPath, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(cwd, absolutePath, hidden, files)
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
  await walkDirectory(input.cwd, absoluteTargetPath, hidden, files)
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
