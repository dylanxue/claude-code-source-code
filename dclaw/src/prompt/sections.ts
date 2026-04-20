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

export function getMemorySection(context: PromptContext): string | null {
  const memory = context.memory
  if (!memory) {
    return null
  }

  const lines = [
    '# Memory',
    `- memory dir: ${memory.memoryDir}`,
    '- memory stores durable context that may be useful in future conversations',
    '- do not use memory for the current conversation plan, step tracking, or transient execution state',
    '- use plans and tasks for current execution state; use memory for durable user, project, and reference knowledge',
  ]

  const entrypointBlock = [
    '## MEMORY.md',
    `path: ${memory.entrypointPath}`,
    memory.entrypointContent,
  ].join('\n')

  if (memory.recalledEntries.length === 0) {
    lines.push(`- recalled memories for this query: 0/${memory.manifestCount}`)
    return [
      lines.join('\n'),
      entrypointBlock,
    ].join('\n\n')
  }

  const blocks = memory.recalledEntries.map(entry =>
    [
      `## [${entry.type}] ${entry.name}`,
      `path: ${entry.path}`,
      `updated_at: ${entry.updatedAt}`,
      `description: ${entry.description}`,
      '',
      entry.content,
    ].join('\n'),
  )

  return [
    lines.join('\n'),
    entrypointBlock,
    `## Recalled Memories\n- recalled memories for this query: ${memory.recalledEntries.length}/${memory.manifestCount}`,
    ...blocks,
  ].join('\n\n')
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
