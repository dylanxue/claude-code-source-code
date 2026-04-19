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
    '- For multi-step or cross-cutting work, create and maintain a task list with TaskCreate and TaskUpdate.',
  ].join('\n')
}

export function getContextSection(context: PromptContext): string {
  return [
    '# Runtime Context',
    `- cwd: ${context.cwd}`,
    `- mode: ${context.mode}`,
    `- provider: ${context.provider}`,
    `- model: ${context.model ?? 'default'}`,
    ...(context.permissionMode
      ? [`- permission mode: ${context.permissionMode}`]
      : []),
  ].join('\n')
}

export function getPlanModeSection(context: PromptContext): string | null {
  const plan = context.plan
  if (!plan && context.permissionMode !== 'plan') {
    return null
  }

  const lines = ['# Planning State']
  lines.push(`- plan mode: ${plan?.status ?? 'inactive'}`)

  if (plan?.boardId) {
    lines.push(`- task board: ${plan.boardId}`)
  }
  if (plan?.planFilePath) {
    lines.push(`- plan file: ${plan.planFilePath}`)
  }
  if (plan?.currentTaskTitle) {
    lines.push(`- current task: ${plan.currentTaskTitle}`)
  }
  if (plan?.currentStep) {
    lines.push(`- current step: ${plan.currentStep}`)
  }

  if (context.permissionMode === 'plan') {
    lines.push('- planning mode is active: do not start implementation yet')
    lines.push('- while planning, only read-only tools and plan-file edits are allowed')
    if (plan?.planFilePath) {
      lines.push('- the plan file is the only file you may edit during planning')
    }
    lines.push('- focus on exploring the codebase, refining the plan, and clarifying ambiguities')
  }

  if (plan?.taskSummary && plan.taskSummary.length > 0) {
    lines.push('- pending work summary:')
    for (const item of plan.taskSummary) {
      lines.push(`  ${item}`)
    }
  }

  return lines.join('\n')
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
