import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  formatMemoryDocument,
  parseMemoryDocument,
  type MemoryFrontmatter,
} from './frontmatter.js'
import {
  getMemoryDir,
  getMemoryEntrypointPath,
  getMemoryFilePath,
} from './paths.js'

export type StoredMemoryFile = {
  path: string
  relativePath: string
  content: string
  body: string
  frontmatter: MemoryFrontmatter | null
  mtimeMs: number
}

export type WriteMemoryInput = {
  workspaceRoot: string
  frontmatter: MemoryFrontmatter
  body: string
  relativePath?: string
  env?: NodeJS.ProcessEnv
}

export type DeleteMemoryInput = {
  workspaceRoot: string
  relativePath: string
  env?: NodeJS.ProcessEnv
}

export type DeleteMemoryResult = {
  path: string
  relativePath: string
  didDelete: boolean
}

const MEMORY_ENTRYPOINT_CONTENT = [
  '# Memory',
  '',
  'This directory stores file-based persistent memories for the workspace.',
  'Each memory lives in its own markdown file with frontmatter.',
  '',
].join('\n')

function sanitizeMemoryFileStem(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized.length > 0 ? sanitized : 'memory'
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const results: string[] = []
  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await collectMarkdownFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') {
      results.push(entryPath)
    }
  }

  return results
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

function isWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const rel = relative(resolve(directoryPath), resolve(targetPath))
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel))
}

function resolveMemoryRelativePath(
  workspaceRoot: string,
  relativePath: string,
  env: NodeJS.ProcessEnv,
): {
  memoryDir: string
  path: string
  relativePath: string
} {
  const memoryDir = getMemoryDir(workspaceRoot, env)
  const normalizedRelativePath = relativePath.trim()
  if (!normalizedRelativePath) {
    throw new Error('Memory path is required.')
  }

  const path = resolve(memoryDir, normalizedRelativePath)
  if (!isWithinDirectory(path, memoryDir)) {
    throw new Error(`Memory path must stay inside ${memoryDir}`)
  }
  if (basename(path) === 'MEMORY.md') {
    throw new Error('MEMORY.md is the memory index and cannot be deleted.')
  }
  if (!path.endsWith('.md')) {
    throw new Error('Only memory markdown files can be deleted.')
  }

  return {
    memoryDir,
    path,
    relativePath: relative(memoryDir, path),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function removeMemoryEntrypointLink(
  workspaceRoot: string,
  relativePath: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const entrypointPath = getMemoryEntrypointPath(workspaceRoot, env)
  let content
  try {
    content = await readFile(entrypointPath, 'utf8')
  } catch {
    return
  }

  const rawPath = escapeRegExp(relativePath)
  const encodedPath = escapeRegExp(
    relativePath.split('/').map(encodeURIComponent).join('/'),
  )
  const linkPattern = new RegExp(`\\]\\((?:\\./)?(?:${rawPath}|${encodedPath})(?:#[^)]+)?\\)`, 'u')
  const nextLines = content
    .split('\n')
    .filter(line => !linkPattern.test(line))
  const nextContent = nextLines.join('\n')
  if (nextContent !== content) {
    await writeFile(entrypointPath, nextContent, 'utf8')
  }
}

export async function ensureMemoryScaffold(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  memoryDir: string
  entrypointPath: string
}> {
  const memoryDir = getMemoryDir(workspaceRoot, env)
  const entrypointPath = getMemoryEntrypointPath(workspaceRoot, env)
  await ensureDirectory(memoryDir)

  try {
    await readFile(entrypointPath, 'utf8')
  } catch {
    await writeFile(entrypointPath, MEMORY_ENTRYPOINT_CONTENT, 'utf8')
  }

  return {
    memoryDir,
    entrypointPath,
  }
}

export async function writeMemoryFile(
  input: WriteMemoryInput,
): Promise<StoredMemoryFile> {
  const env = input.env ?? process.env
  await ensureMemoryScaffold(input.workspaceRoot, env)

  const relativePath =
    input.relativePath ?? `${sanitizeMemoryFileStem(input.frontmatter.name)}.md`
  const filePath = getMemoryFilePath(input.workspaceRoot, relativePath, env)
  await ensureDirectory(dirname(filePath))
  await writeFile(
    filePath,
    formatMemoryDocument(input.frontmatter, input.body),
    'utf8',
  )

  const stored = await readMemoryFile(filePath, getMemoryDir(input.workspaceRoot, env))
  if (!stored) {
    throw new Error(`Failed to read memory file after writing: ${filePath}`)
  }

  return stored
}

export async function readMemoryFile(
  filePath: string,
  memoryDir?: string,
): Promise<StoredMemoryFile | null> {
  try {
    const [content, fileStat] = await Promise.all([
      readFile(filePath, 'utf8'),
      stat(filePath),
    ])
    const parsed = parseMemoryDocument(content)
    return {
      path: filePath,
      relativePath: memoryDir ? relative(memoryDir, filePath) : basename(filePath),
      content,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      mtimeMs: fileStat.mtimeMs,
    }
  } catch {
    return null
  }
}

export async function listMemoryFiles(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredMemoryFile[]> {
  const memoryDir = getMemoryDir(workspaceRoot, env)
  const filePaths = await collectMarkdownFiles(memoryDir)
  const files = await Promise.all(
    filePaths.map(filePath => readMemoryFile(filePath, memoryDir)),
  )

  return files
    .filter((file): file is StoredMemoryFile => file !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export async function deleteMemoryFile(
  input: DeleteMemoryInput,
): Promise<DeleteMemoryResult> {
  const env = input.env ?? process.env
  await ensureMemoryScaffold(input.workspaceRoot, env)
  const resolved = resolveMemoryRelativePath(
    input.workspaceRoot,
    input.relativePath,
    env,
  )

  try {
    await unlink(resolved.path)
    await removeMemoryEntrypointLink(
      input.workspaceRoot,
      resolved.relativePath,
      env,
    )
    return {
      path: resolved.path,
      relativePath: resolved.relativePath,
      didDelete: true,
    }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {
        path: resolved.path,
        relativePath: resolved.relativePath,
        didDelete: false,
      }
    }

    throw error
  }
}
