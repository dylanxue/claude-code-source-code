import {
  formatContextStatsLines,
  type ContextStats,
} from '../core/contextStats.js'

export type BuildCompactPromptInput = {
  transcriptLines: string[]
  instructionText?: string
  contextStats?: ContextStats
  sessionMemory?: {
    path: string
    content: string
  }
}

export function getCompactSystemPrompt(): string {
  return [
    'You are generating a compact summary for a coding assistant session.',
    'Respond with plain text only.',
    'Do not call tools.',
    'Wrap any scratch reasoning in <analysis> tags and put the final compacted output in <summary> tags.',
    'The <summary> block should preserve the user intent, current work, recent decisions, key files, open risks, and the most important next-step context needed to continue the task.',
    'Prefer concise but information-dense technical summaries over transcript-style retelling.',
  ].join('\n')
}

export function buildCompactUserPrompt(
  input: BuildCompactPromptInput,
): string {
  const summaryGoalLines = [
    'Summarize the conversation context below so the compacted session can continue work without replaying the full transcript.',
    'Focus on current goals, recent implementation progress, concrete file references, unresolved issues, and any constraints the assistant must continue following.',
  ]
  const instructionSection =
    input.instructionText && input.instructionText.trim().length > 0
      ? [
          '## Compact Instructions',
          input.instructionText.trim(),
          '',
        ]
      : []
  const contextStatsSection =
    input.contextStats
      ? [
          '## Context Stats',
          ...formatContextStatsLines(input.contextStats),
          '',
        ]
      : []
  const sessionMemorySection =
    input.sessionMemory
      ? [
          '## Session Memory',
          `path: ${input.sessionMemory.path}`,
          input.sessionMemory.content.trim(),
          '',
        ]
      : []
  return [
    ...summaryGoalLines,
    '',
    ...instructionSection,
    ...contextStatsSection,
    ...sessionMemorySection,
    '## Transcript',
    ...(input.transcriptLines.length > 0 ? input.transcriptLines : ['<empty>']),
  ].join('\n')
}
