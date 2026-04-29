import { readFile } from 'node:fs/promises'
import {
  findLastCompactBoundaryIndex,
  isFreshlyCompactedSession,
} from '../compact/boundaryMessage.js'
import {
  buildPersistedInvokedSkillsReminderText,
  buildSkillPrompt,
} from '../skills/prompt.js'
import type { InvokedSkill } from '../skills/state.js'
import { createMessage, createTextMessage, type Message } from '../types/message.js'
import type { ReadStateEntry } from '../types/tool.js'

const MAX_POST_COMPACT_FILES = 3
const MAX_POST_COMPACT_FILE_CHARS = 4_000
const MAX_POST_COMPACT_PLAN_FILE_CHARS = 8_000
const MAX_POST_COMPACT_TOTAL_FILE_CHARS = 10_000
const MAX_POST_COMPACT_IMAGES = 2
const MAX_POST_COMPACT_TOTAL_IMAGE_CHARS = 300_000
const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
const APPROX_ASCII_CHARS_PER_TOKEN = 4

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

function countAsciiChars(text: string): number {
  let asciiChars = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) <= 0x7f) {
      asciiChars += 1
    }
  }
  return asciiChars
}

function estimateApproxTokens(text: string): number {
  const asciiChars = countAsciiChars(text)
  const nonAsciiChars = text.length - asciiChars
  return Math.ceil(asciiChars / APPROX_ASCII_CHARS_PER_TOKEN) + nonAsciiChars
}

function truncateToApproxTokens(text: string, maxTokens: number): string {
  if (maxTokens < 1 || text.length === 0) {
    return ''
  }

  let asciiChars = 0
  let nonAsciiChars = 0
  let endIndex = 0

  for (; endIndex < text.length; endIndex += 1) {
    const code = text.charCodeAt(endIndex)
    if (code <= 0x7f) {
      asciiChars += 1
    } else {
      nonAsciiChars += 1
    }

    const approxTokens =
      Math.ceil(asciiChars / APPROX_ASCII_CHARS_PER_TOKEN) + nonAsciiChars
    if (approxTokens > maxTokens) {
      break
    }
  }

  if (endIndex >= text.length) {
    return text
  }

  return `${text.slice(0, endIndex)}\n...[truncated after ~${maxTokens} tokens]`
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
  planFilePath: string,
): Promise<Message | null> {
  try {
    const content = await readFile(planFilePath, 'utf8')
    const trimmed = content.trim()
    if (trimmed.length === 0) {
      return null
    }

    const { text } = truncateText(trimmed, MAX_POST_COMPACT_PLAN_FILE_CHARS)
    return wrapSystemReminder(
      [
        '# Post-Compact Plan File',
        `path: ${planFilePath}`,
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

function createPostCompactInvokedSkillMessage(
  invokedSkills: InvokedSkill[],
): Message | null {
  if (invokedSkills.length === 0) {
    return null
  }

  let usedTokens = 0
  const budgetedSkills = invokedSkills
    .map(skill => ({
      ...skill,
      prompt: truncateToApproxTokens(
        skill.prompt,
        POST_COMPACT_MAX_TOKENS_PER_SKILL,
      ),
    }))
    .filter(skill => {
      const tokens = estimateApproxTokens(
        [
          `### Skill: ${skill.name}`,
          `path: ${skill.path}`,
          `source: ${skill.source}`,
          '',
          buildSkillPrompt(skill),
        ].join('\n'),
      )
      if (usedTokens + tokens > POST_COMPACT_SKILLS_TOKEN_BUDGET) {
        return false
      }

      usedTokens += tokens
      return true
    })

  if (budgetedSkills.length === 0) {
    return null
  }

  return wrapSystemReminder(
    buildPersistedInvokedSkillsReminderText(budgetedSkills),
  )
}

function createPostCompactImageMessages(messages: Message[]): Message[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  if (boundaryIndex <= 0) {
    return []
  }

  const attachments: Message[] = []
  const seenToolUseIds = new Set<string>()
  let usedChars = 0

  for (let index = boundaryIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    for (const block of message.content) {
      if (
        block.type !== 'tool_result' ||
        seenToolUseIds.has(block.toolUseId) ||
        !Array.isArray(block.content) ||
        !block.content.some(item => item.type === 'image')
      ) {
        continue
      }

      const nextSize = block.content.reduce(
        (total, item) =>
          total +
          (item.type === 'text'
            ? item.text.length
            : item.source.mediaType.length +
              item.source.data.length +
              (item.type === 'pdf' ? (item.filename?.length ?? 0) : 0)),
        0,
      )
      if (usedChars + nextSize > MAX_POST_COMPACT_TOTAL_IMAGE_CHARS) {
        continue
      }

      seenToolUseIds.add(block.toolUseId)
      usedChars += nextSize
      attachments.push(
        createMessage(
          'user',
          block.content.map(item =>
            item.type === 'text'
              ? {
                  type: 'text' as const,
                  text: item.text,
                  ...(item.annotations ? { annotations: item.annotations } : {}),
                }
              : item.type === 'image'
              ? {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    mediaType: item.source.mediaType,
                    data: item.source.data,
                  },
                }
              : {
                  type: 'pdf' as const,
                  source: {
                    type: 'base64' as const,
                    mediaType: item.source.mediaType,
                    data: item.source.data,
                  },
                  ...(item.filename ? { filename: item.filename } : {}),
                },
          ),
        ),
      )

      if (attachments.length >= MAX_POST_COMPACT_IMAGES) {
        return attachments.reverse()
      }
    }
  }

  return attachments.reverse()
}

export async function createPostCompactAttachmentMessages(
  messages: Message[],
  planFilePath: string | null | undefined,
  readState: PostCompactReadStateSnapshot | undefined,
  invokedSkills: InvokedSkill[],
  _availableTools: string[],
): Promise<Message[]> {
  if (!isFreshlyCompactedSession(messages)) {
    return []
  }

  const attachmentMessages = createPostCompactReadFileMessages(readState)
  const invokedSkillMessage = createPostCompactInvokedSkillMessage(invokedSkills)
  const imageMessages = createPostCompactImageMessages(messages)
  const planFileMessage = planFilePath
    ? await createPostCompactPlanFileMessage(planFilePath)
    : null

  return [
    ...attachmentMessages,
    ...(invokedSkillMessage ? [invokedSkillMessage] : []),
    ...imageMessages,
    ...(planFileMessage ? [planFileMessage] : []),
  ]
}
