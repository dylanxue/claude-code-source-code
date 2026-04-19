import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
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
