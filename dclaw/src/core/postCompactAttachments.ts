import { readFile } from 'node:fs/promises'
import { isFreshlyCompactedSession } from '../compact/boundaryMessage.js'
import type { TaskBoard } from '../tasks/types.js'
import { createTextMessage, type Message } from '../types/message.js'
import type { ReadStateEntry } from '../types/tool.js'
import { createForcedTaskToolReminderMessage } from './taskToolReminder.js'

const MAX_POST_COMPACT_FILES = 3
const MAX_POST_COMPACT_FILE_CHARS = 4_000
const MAX_POST_COMPACT_PLAN_FILE_CHARS = 8_000
const MAX_POST_COMPACT_TOTAL_FILE_CHARS = 10_000

export type PostCompactReadStateSnapshot = Map<string, ReadStateEntry>

function wrapSystemReminder(text: string): Message {
  return createTextMessage('user', `<system-reminder>\n${text}\n</system-reminder>`)
}

function truncateText(
  text: string,
  maxChars: number,
): {
  text: string
  truncated: boolean
} {
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
    }
  }

  return {
    text: `${text.slice(0, maxChars)}\n...[truncated after ${maxChars} chars]`,
    truncated: true,
  }
}

function buildPostCompactReadFileMessage(
  filePath: string,
  entry: ReadStateEntry,
): Message {
  const { text } = truncateText(entry.content, MAX_POST_COMPACT_FILE_CHARS)
  const viewKind = entry.isPartialView ? 'partial' : 'full'
  const rangeLine =
    entry.offset !== undefined || entry.limit !== undefined
      ? `range: offset=${entry.offset ?? 1}, limit=${entry.limit ?? 'all'}`
      : null

  return wrapSystemReminder(
    [
      '# Post-Compact Read File',
      `path: ${filePath}`,
      `view: ${viewKind}`,
      ...(rangeLine ? [rangeLine] : []),
      'This file content was available before compaction. Re-read the file if you need fresher or broader context.',
      '',
      text,
    ].join('\n'),
  )
}

async function createPostCompactPlanFileMessage(
  board: TaskBoard,
): Promise<Message | null> {
  if (!board.planFilePath) {
    return null
  }

  try {
    const content = await readFile(board.planFilePath, 'utf8')
    const trimmed = content.trim()
    if (trimmed.length === 0) {
      return null
    }

    const { text } = truncateText(trimmed, MAX_POST_COMPACT_PLAN_FILE_CHARS)
    return wrapSystemReminder(
      [
        '# Post-Compact Plan File',
        `path: ${board.planFilePath}`,
        'This is the current plan file content restored after compaction.',
        '',
        text,
      ].join('\n'),
    )
  } catch {
    return null
  }
}

export function snapshotReadState(
  readState: Map<string, ReadStateEntry>,
): PostCompactReadStateSnapshot {
  return new Map(
    [...readState.entries()].map(([path, entry]) => [
      path,
      { ...entry },
    ]),
  )
}

function createPostCompactReadFileMessages(
  readState: PostCompactReadStateSnapshot | undefined,
): Message[] {
  if (!readState || readState.size === 0) {
    return []
  }

  let usedChars = 0
  const recentFiles = [...readState.entries()]
    .sort((left, right) => right[1].timestamp - left[1].timestamp)
    .slice(0, MAX_POST_COMPACT_FILES)

  const messages: Message[] = []
  for (const [filePath, entry] of recentFiles) {
    if (!entry.content.trim()) {
      continue
    }

    const nextSize = Math.min(entry.content.length, MAX_POST_COMPACT_FILE_CHARS)
    if (usedChars + nextSize > MAX_POST_COMPACT_TOTAL_FILE_CHARS) {
      break
    }

    usedChars += nextSize
    messages.push(buildPostCompactReadFileMessage(filePath, entry))
  }

  return messages
}

export async function createPostCompactAttachmentMessages(
  messages: Message[],
  board: TaskBoard | null | undefined,
  readState: PostCompactReadStateSnapshot | undefined,
  availableTools: string[],
): Promise<Message[]> {
  if (!isFreshlyCompactedSession(messages)) {
    return []
  }

  const attachmentMessages = createPostCompactReadFileMessages(readState)
  const planFileMessage = board
    ? await createPostCompactPlanFileMessage(board)
    : null
  const taskReminderMessage = createForcedTaskToolReminderMessage(
    board,
    availableTools,
  )

  return [
    ...attachmentMessages,
    ...(planFileMessage ? [planFileMessage] : []),
    ...(taskReminderMessage ? [taskReminderMessage] : []),
  ]
}
