import type { PromptContext } from './types.js'

export function getIntroSection(): string {
  return [
    '# System',
    'You are dclaw, a terminal-first general agent.',
    'Help the user by reasoning over the conversation, using tools when available, and reporting outcomes faithfully.',
  ].join('\n')
}

export function getDoingTasksSection(): string {
  return [
    '# Doing Tasks',
    '- Read context before making changes.',
    '- Do not claim success for checks you did not run.',
    '- Use the available tools carefully and report outcomes faithfully.',
  ].join('\n')
}

export function getContextSection(context: PromptContext): string {
  return [
    '# Runtime Context',
    `- cwd: ${context.cwd}`,
    `- mode: ${context.mode}`,
    `- provider: ${context.provider}`,
    `- model: ${context.model ?? 'default'}`,
  ].join('\n')
}

export function getClaudeMdSection(context: PromptContext): string | null {
  if (context.claudeMdEntries.length === 0) {
    return null
  }

  const blocks = context.claudeMdEntries.map(entry =>
    [
      `## ${entry.source} instructions`,
      `path: ${entry.path}`,
      entry.content,
    ].join('\n'),
  )

  return ['# CLAUDE.md Instructions', ...blocks].join('\n\n')
}

export function getUserOverrideSection(context: PromptContext): string | null {
  if (!context.userSystemPrompt) {
    return null
  }

  return ['# User Override', context.userSystemPrompt].join('\n')
}
