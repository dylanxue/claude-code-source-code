import { createTextMessage, getTextContent } from '../types/message.js'
import type { QueryTraceSink } from '../core/queryTrace.js'
import type { LlmClient } from '../llm/types.js'
import type { MemoryManifestEntry } from './manifest.js'

const MEMORY_SELECTOR_SYSTEM_PROMPT = [
  'You are selecting memories that will be useful to dclaw as it processes a user query.',
  'You will be given the current user query, recent successful tool activity when available, and a list of available memory files with their relative paths, names, descriptions, and types.',
  'Return a JSON object with shape {"selected_memories":["relative/path.md"]}.',
  'Only include memory files that will clearly be useful for the current query.',
  'If you are unsure whether a memory will help, leave it out.',
  'Return at most 5 relative paths.',
  'Do not return any paths that are not present in the provided list.',
  'Return JSON only, with no markdown fences or commentary.',
].join('\n')

function formatSelectionManifest(entries: MemoryManifestEntry[]): string {
  return entries
    .map(
      entry =>
        `- [${entry.type}] ${entry.relativePath} | ${entry.name} (${entry.updatedAt}): ${entry.description}`,
    )
    .join('\n')
}

function formatRecentTools(tools: string[] | undefined): string {
  if (!tools || tools.length === 0) {
    return 'Recent tools: none'
  }

  return [
    'Recent tools:',
    ...tools.map(tool => `- ${tool}`),
  ].join('\n')
}

function extractJsonPayload(text: string): string | null {
  const trimmed = text.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim()
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    return null
  }

  return trimmed.slice(start, end + 1)
}

type ParsedSelectorResult = {
  selected_memories?: unknown
}

export function parseSelectedMemoryPaths(
  responseText: string,
  validRelativePaths: ReadonlySet<string>,
): string[] {
  const payload = extractJsonPayload(responseText)
  if (!payload) {
    return []
  }

  let parsed: ParsedSelectorResult
  try {
    parsed = JSON.parse(payload) as ParsedSelectorResult
  } catch {
    return []
  }

  if (!Array.isArray(parsed.selected_memories)) {
    return []
  }

  const unique = new Set<string>()
  for (const value of parsed.selected_memories) {
    if (typeof value !== 'string') {
      continue
    }
    if (!validRelativePaths.has(value)) {
      continue
    }
    unique.add(value)
    if (unique.size >= 5) {
      break
    }
  }

  return [...unique]
}

export async function selectRelevantMemoryEntries(input: {
  client: LlmClient
  model?: string
  query: string
  entries: MemoryManifestEntry[]
  recentTools?: string[]
  signal?: AbortSignal
  queryTraceSink?: QueryTraceSink
}): Promise<MemoryManifestEntry[]> {
  if (input.entries.length === 0 || input.query.trim().length === 0) {
    return []
  }

  const validRelativePaths = new Set(
    input.entries.map(entry => entry.relativePath),
  )
  input.queryTraceSink?.record({
    event: 'memory.recall.select.start',
    data: {
      model: input.model ?? 'default',
      manifestCount: input.entries.length,
      recentToolCount: input.recentTools?.length ?? 0,
    },
  })

  try {
    const response = await input.client.createMessage({
      model: input.model,
      systemPrompt: MEMORY_SELECTOR_SYSTEM_PROMPT,
      messages: [
        createTextMessage(
          'user',
          [
            `Query: ${input.query}`,
            '',
            formatRecentTools(input.recentTools),
            '',
            'Available memories:',
            formatSelectionManifest(input.entries),
            '',
            'Return JSON only.',
          ].join('\n'),
        ),
      ],
      signal: input.signal,
    })
    const selectedRelativePaths = parseSelectedMemoryPaths(
      getTextContent(response.message),
      validRelativePaths,
    )
    const selectedByPath = new Map(
      input.entries.map(entry => [entry.relativePath, entry]),
    )
    const selectedEntries = selectedRelativePaths
      .map(relativePath => selectedByPath.get(relativePath))
      .filter((entry): entry is MemoryManifestEntry => entry !== undefined)

    input.queryTraceSink?.record({
      event: 'memory.recall.select.success',
      data: {
        model: input.model ?? 'default',
        manifestCount: input.entries.length,
        selectedCount: selectedEntries.length,
        selectedPaths: selectedEntries.map(entry => entry.path),
      },
    })

    return selectedEntries
  } catch (error) {
    input.queryTraceSink?.record({
      event: 'memory.recall.select.failure',
      data: {
        model: input.model ?? 'default',
        manifestCount: input.entries.length,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return []
  }
}
