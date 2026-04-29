import { createTextMessage, type Message } from '../types/message.js'
import type { PromptMemoryContext } from './prompt.js'

function getMemoryFreshnessLines(updatedAt: string, nowMs: number = Date.now()): string[] {
  const updatedMs = Date.parse(updatedAt)
  if (Number.isNaN(updatedMs)) {
    return [
      'freshness: unknown',
      'freshness note: verify this memory against current project state before relying on it',
    ]
  }

  const ageDays = Math.max(0, Math.floor((nowMs - updatedMs) / 86_400_000))
  if (ageDays <= 30) {
    return [`freshness: recent (${ageDays} days old)`]
  }
  if (ageDays <= 180) {
    return [`freshness: aging (${ageDays} days old)`]
  }

  return [
    `freshness: stale (${ageDays} days old)`,
    'freshness note: verify this memory against current project state before relying on it',
  ]
}

export function createRelevantMemoryReminderMessage(
  memory: PromptMemoryContext,
): Message | undefined {
  if (memory.recalledEntries.length === 0) {
    return undefined
  }

  const blocks = memory.recalledEntries.map(entry =>
    [
      `## [${entry.type}] ${entry.name}`,
      `path: ${entry.path}`,
      `updated_at: ${entry.updatedAt}`,
      ...getMemoryFreshnessLines(entry.updatedAt),
      `description: ${entry.description}`,
      '',
      entry.content,
    ].join('\n'),
  )

  return createTextMessage(
    'user',
    [
      '<system-reminder>',
      'Relevant memories prefetched for the current query:',
      `- recalled memories for this query: ${memory.recalledEntries.length}/${memory.manifestCount}`,
      '',
      ...blocks,
      '</system-reminder>',
    ].join('\n'),
  )
}
