import { loadMemoryManifest, type MemoryManifestEntry } from './manifest.js'
import { getMemoryEntrypointPath, getMemoryDir } from './paths.js'
import type { QueryTraceSink } from '../core/queryTrace.js'
import type { LlmClient } from '../llm/types.js'
import { selectRelevantMemoryEntries } from './select.js'
import { readMemoryFile } from './store.js'

export const MAX_RECALLED_MEMORY_COUNT = 5
export const MAX_RECALLED_MEMORY_LINES = 200
export const MAX_RECALLED_MEMORY_BYTES = 4096
export const MAX_MEMORY_ENTRYPOINT_LINES = 200
export const MAX_MEMORY_ENTRYPOINT_BYTES = 25_000
export const MAX_SURFACED_MEMORY_SESSION_BYTES = 64_000

export type PromptMemoryEntry = MemoryManifestEntry & {
  content: string
  wasTruncated: boolean
}

export type PromptMemoryContext = {
  memoryDir: string
  entrypointPath: string
  entrypointContent: string
  entrypointWasTruncated: boolean
  manifestCount: number
  recalledEntries: PromptMemoryEntry[]
  recalledBytes: number
  skippedAlreadySurfacedCount: number
  skippedBySessionByteLimitCount: number
}

function truncateToByteLimit(value: string, byteLimit: number): string {
  let result = ''
  let bytes = 0

  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf8')
    if (bytes + charBytes > byteLimit) {
      break
    }
    result += char
    bytes += charBytes
  }

  return result
}

function truncateMemoryContent(
  content: string,
  filePath: string,
): {
  content: string
  wasTruncated: boolean
} {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const truncatedByLines = lines.length > MAX_RECALLED_MEMORY_LINES
  let limited = truncatedByLines
    ? lines.slice(0, MAX_RECALLED_MEMORY_LINES).join('\n')
    : normalized

  const truncatedByBytes =
    Buffer.byteLength(limited, 'utf8') > MAX_RECALLED_MEMORY_BYTES
  if (truncatedByBytes) {
    limited = truncateToByteLimit(limited, MAX_RECALLED_MEMORY_BYTES)
  }

  const wasTruncated = truncatedByLines || truncatedByBytes
  if (!wasTruncated) {
    return {
      content: limited.trim(),
      wasTruncated: false,
    }
  }

  return {
    content: [
      limited.trimEnd(),
      '',
      `> This memory file was truncated (${truncatedByBytes ? `${MAX_RECALLED_MEMORY_BYTES} byte limit` : `first ${MAX_RECALLED_MEMORY_LINES} lines`}). Use the Read tool to inspect the complete file at: ${filePath}`,
    ].join('\n'),
    wasTruncated: true,
  }
}

async function loadPromptMemoryEntry(
  entry: MemoryManifestEntry,
  memoryDir: string,
): Promise<PromptMemoryEntry | null> {
  const file = await readMemoryFile(entry.path, memoryDir)
  if (!file) {
    return null
  }

  const truncated = truncateMemoryContent(file.body, entry.path)
  return {
    ...entry,
    content: truncated.content,
    wasTruncated: truncated.wasTruncated,
  }
}

function getMemoryEntryByteSize(entry: PromptMemoryEntry): number {
  return Buffer.byteLength(entry.content, 'utf8')
}

function filterAlreadySurfacedEntries(
  entries: MemoryManifestEntry[],
  excludedPaths: ReadonlySet<string> | undefined,
): {
  entries: MemoryManifestEntry[]
  skippedCount: number
} {
  if (!excludedPaths || excludedPaths.size === 0) {
    return { entries, skippedCount: 0 }
  }

  const filtered = entries.filter(
    entry =>
      !excludedPaths.has(entry.path) &&
      !excludedPaths.has(entry.relativePath),
  )

  return {
    entries: filtered,
    skippedCount: entries.length - filtered.length,
  }
}

function applySessionByteLimit(
  entries: PromptMemoryEntry[],
  remainingBytes: number | undefined,
): {
  entries: PromptMemoryEntry[]
  bytes: number
  skippedCount: number
} {
  const limit =
    typeof remainingBytes === 'number' && Number.isFinite(remainingBytes)
      ? Math.max(0, remainingBytes)
      : MAX_SURFACED_MEMORY_SESSION_BYTES
  const selected: PromptMemoryEntry[] = []
  let usedBytes = 0

  for (const entry of entries) {
    const entryBytes = getMemoryEntryByteSize(entry)
    if (usedBytes + entryBytes > limit) {
      continue
    }

    selected.push(entry)
    usedBytes += entryBytes
  }

  return {
    entries: selected,
    bytes: usedBytes,
    skippedCount: entries.length - selected.length,
  }
}

function truncateMemoryEntrypoint(
  content: string,
  filePath: string,
): {
  content: string
  wasTruncated: boolean
} {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) {
    return {
      content: 'Your MEMORY.md is currently empty. When you save new memories, they will appear here.',
      wasTruncated: false,
    }
  }

  const lines = normalized.split('\n')
  const truncatedByLines = lines.length > MAX_MEMORY_ENTRYPOINT_LINES
  let limited = truncatedByLines
    ? lines.slice(0, MAX_MEMORY_ENTRYPOINT_LINES).join('\n')
    : normalized

  const truncatedByBytes =
    Buffer.byteLength(limited, 'utf8') > MAX_MEMORY_ENTRYPOINT_BYTES
  if (truncatedByBytes) {
    limited = truncateToByteLimit(limited, MAX_MEMORY_ENTRYPOINT_BYTES)
  }

  const wasTruncated = truncatedByLines || truncatedByBytes
  if (!wasTruncated) {
    return {
      content: limited,
      wasTruncated: false,
    }
  }

  return {
    content: [
      limited.trimEnd(),
      '',
      `> WARNING: MEMORY.md was truncated (${truncatedByBytes ? `${MAX_MEMORY_ENTRYPOINT_BYTES} byte limit` : `first ${MAX_MEMORY_ENTRYPOINT_LINES} lines`}). Keep the index concise and use the Read tool to inspect the complete file at: ${filePath}`,
    ].join('\n'),
    wasTruncated: true,
  }
}

async function loadMemoryEntrypoint(
  entrypointPath: string,
): Promise<{
  content: string
  wasTruncated: boolean
}> {
  const file = await readMemoryFile(entrypointPath)
  if (!file) {
    return {
      content: 'Your MEMORY.md is currently empty. When you save new memories, they will appear here.',
      wasTruncated: false,
    }
  }

  return truncateMemoryEntrypoint(file.body, entrypointPath)
}

export async function loadPromptMemoryContext(
  workspaceRoot: string,
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    client?: LlmClient
    model?: string
    queryTraceSink?: QueryTraceSink
    excludedPaths?: ReadonlySet<string>
    remainingSessionBytes?: number
    recentTools?: string[]
    signal?: AbortSignal
  },
): Promise<PromptMemoryContext> {
  const memoryDir = getMemoryDir(workspaceRoot, env)
  const entrypointPath = getMemoryEntrypointPath(workspaceRoot, env)

  try {
    const manifest = await loadMemoryManifest(workspaceRoot, env)
    const entrypoint = await loadMemoryEntrypoint(entrypointPath)
    const surfacedFilter = filterAlreadySurfacedEntries(
      manifest,
      options?.excludedPaths,
    )
    if (manifest.length === 0 || surfacedFilter.entries.length === 0 || query.trim().length === 0) {
      return {
        memoryDir,
        entrypointPath,
        entrypointContent: entrypoint.content,
        entrypointWasTruncated: entrypoint.wasTruncated,
        manifestCount: manifest.length,
        recalledEntries: [],
        recalledBytes: 0,
        skippedAlreadySurfacedCount: surfacedFilter.skippedCount,
        skippedBySessionByteLimitCount: 0,
      }
    }

    const recalled =
      options?.client
        ? await selectRelevantMemoryEntries({
            client: options.client,
            model: options.model,
            query,
            entries: surfacedFilter.entries,
            recentTools: options.recentTools,
            signal: options.signal,
            queryTraceSink: options.queryTraceSink,
          })
        : []
    const loadedEntries = (
      await Promise.all(
        recalled.map(entry => loadPromptMemoryEntry(entry, memoryDir)),
      )
    ).filter((entry): entry is PromptMemoryEntry => entry !== null)
    const limitedEntries = applySessionByteLimit(
      loadedEntries,
      options?.remainingSessionBytes,
    )

    return {
      memoryDir,
      entrypointPath,
      entrypointContent: entrypoint.content,
      entrypointWasTruncated: entrypoint.wasTruncated,
      manifestCount: manifest.length,
      recalledEntries: limitedEntries.entries,
      recalledBytes: limitedEntries.bytes,
      skippedAlreadySurfacedCount: surfacedFilter.skippedCount,
      skippedBySessionByteLimitCount: limitedEntries.skippedCount,
    }
  } catch {
    return {
      memoryDir,
      entrypointPath,
      entrypointContent:
        'Your MEMORY.md is currently empty. When you save new memories, they will appear here.',
      entrypointWasTruncated: false,
      manifestCount: 0,
      recalledEntries: [],
      recalledBytes: 0,
      skippedAlreadySurfacedCount: 0,
      skippedBySessionByteLimitCount: 0,
    }
  }
}
