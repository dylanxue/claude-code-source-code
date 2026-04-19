import type { MemoryFrontmatter } from './frontmatter.js'
import { listMemoryFiles, type StoredMemoryFile } from './store.js'

export type MemoryManifestEntry = {
  name: string
  description: string
  type: MemoryFrontmatter['type']
  updatedAt: string
  path: string
  relativePath: string
  mtimeMs: number
}

function getSortTimestamp(entry: MemoryManifestEntry): number {
  const parsed = Date.parse(entry.updatedAt)
  return Number.isNaN(parsed) ? entry.mtimeMs : parsed
}

export function toMemoryManifestEntry(
  file: StoredMemoryFile,
): MemoryManifestEntry | null {
  if (!file.frontmatter) {
    return null
  }

  return {
    name: file.frontmatter.name,
    description: file.frontmatter.description,
    type: file.frontmatter.type,
    updatedAt: file.frontmatter.updated_at,
    path: file.path,
    relativePath: file.relativePath,
    mtimeMs: file.mtimeMs,
  }
}

export async function loadMemoryManifest(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MemoryManifestEntry[]> {
  const files = await listMemoryFiles(workspaceRoot, env)
  return files
    .map(toMemoryManifestEntry)
    .filter((entry): entry is MemoryManifestEntry => entry !== null)
    .sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a))
}

export function formatMemoryManifest(
  entries: MemoryManifestEntry[],
): string {
  return entries
    .map(
      entry =>
        `- [${entry.type}] ${entry.relativePath} (${entry.updatedAt}): ${entry.description}`,
    )
    .join('\n')
}
