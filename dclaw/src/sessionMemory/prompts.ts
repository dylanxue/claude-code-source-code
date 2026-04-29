import { formatTranscript } from '../session/transcript.js'
import type { Message } from '../types/message.js'

export const SESSION_MEMORY_TEMPLATE = [
  '# Session Memory',
  '',
  '## Current Goal',
  '- <empty>',
  '',
  '## Important Context',
  '- <empty>',
  '',
  '## Decisions',
  '- <empty>',
  '',
  '## Open Work',
  '- <empty>',
  '',
  '## Files And Artifacts',
  '- <empty>',
  '',
].join('\n')

export function getSessionMemoryUpdateSystemPrompt(notesPath: string): string {
  return [
    'You maintain a rolling session-memory.md file for a coding assistant session.',
    'The file is short-lived state for this exact session, not durable user memory.',
    'Preserve current goals, decisions, important files, open risks, and next steps.',
    'Remove stale details that are no longer relevant to continuing the session.',
    'Use only Read and Edit. Edit only this file:',
    notesPath,
    'Do not write any other file.',
  ].join('\n')
}

export function buildSessionMemoryUpdatePrompt(input: {
  notesPath: string
  messages: Message[]
  maxMessages?: number
}): string {
  return [
    `Update ${input.notesPath} using the recent transcript below.`,
    'Keep the notes concise and structured under the existing headings.',
    'If a section has no useful content, keep `- <empty>`.',
    '',
    '## Recent Transcript',
    ...formatTranscript(input.messages, {
      includeThinking: false,
      maxMessages: input.maxMessages ?? 30,
    }),
  ].join('\n')
}
