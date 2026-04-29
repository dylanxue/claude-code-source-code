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
    '- For multi-step or cross-cutting implementation work, use TaskCreate and TaskUpdate only when you are ready to execute immediately.',
    '- If you create a new task board, decompose it into 3 or more concrete tasks; do not open a one-task or two-task board.',
  ].join('\n')
}

export function getPlanCenteredWorkflowSection(): string {
  return [
    '# Task-Board Workflow',
    '- Treat task boards as short-lived execution state for the current multi-step work batch.',
    '- Plan and plan mode are for producing a plan only. Do not create or update tasks while planning.',
    '- A fresh task board must include at least 3 concrete tasks. The optional board brief is only for making the current execution batch easier to understand.',
    '- Do not create a fresh task board with only one or two generic umbrella tasks; either decompose it further or skip task tracking for now.',
    '- If the work breaks into fewer than 3 concrete tasks, skip task tracking for now.',
    '- Creating a task board means execution is starting now. If you are not ready to begin implementation immediately, do not create or expand the task board yet.',
    '- Plan Mode can only be entered or left by the user through manual controls such as /plan or Shift+Tab.',
    '- Do not claim you can enter Plan Mode yourself; there is no model tool for entering Plan Mode.',
    '- ExitPlanMode only requests the user-facing confirmation flow. It does not approve the plan, leave Plan Mode, or start implementation.',
    '- After ExitPlanMode, wait for the user confirmation choice. Do not create tasks until implementation is actually starting.',
  ].join('\n')
}

export function getLanguageSection(): string {
  return [
    '# Language',
    "- Use the same language as the user's latest message unless they explicitly ask for another language.",
    '- Apply this to visible assistant responses, plan files, plan summaries, clarification questions, brief pre-tool progress updates, and any reasoning/thinking summaries when those are exposed.',
  ].join('\n')
}

export function getContextSection(context: PromptContext): string {
  return [
    '# Runtime Context',
    `- cwd: ${context.cwd}`,
    `- mode: ${context.mode}`,
    `- provider: ${context.provider}`,
    `- model: ${context.model ?? 'default'}`,
    ...(context.skillsRuntime
      ? [
          `- skills user dir: ${context.skillsRuntime.userSkillsDir}`,
          `- skills project dir: ${context.skillsRuntime.projectSkillsDir}`,
          '- skills note: dclaw only loads skills from builtin, user, and project .dclaw/skills directories; after installing new skills, call ReloadSkills before using them; if the needed skill is already loaded locally, do not reinstall it and use it directly; for external skill search or installation requests, prefer the builtin install-skills skill before using Bash or WebFetch directly',
        ]
      : []),
    ...(context.permissionMode
      ? [`- permission mode: ${context.permissionMode}`]
      : []),
  ].join('\n')
}

export function getCurrentDateSection(context: PromptContext): string | null {
  if (!context.currentDate) {
    return null
  }

  return ['# Current Date', `- today: ${context.currentDate}`].join('\n')
}

export function getEnvironmentSection(context: PromptContext): string | null {
  if (!context.environment) {
    return null
  }

  const environment = context.environment
  return [
    '# Environment',
    `- is git repository: ${environment.isGitRepository ? 'yes' : 'no'}`,
    `- platform: ${environment.platform}`,
    `- shell: ${environment.shell}`,
    `- os version: ${environment.osVersion}`,
  ].join('\n')
}

export function getGitStatusSection(context: PromptContext): string | null {
  if (!context.gitStatus) {
    return null
  }

  return ['# Git Status', context.gitStatus].join('\n\n')
}

export function getPlanModeSection(context: PromptContext): string | null {
  const plan = context.plan
  if (!plan && context.permissionMode !== 'plan') {
    return null
  }

  const lines = ['# Planning State']
  lines.push(`- plan mode: ${plan?.status ?? 'inactive'}`)

  if (plan?.planFilePath) {
    lines.push(`- plan file: ${plan.planFilePath}`)
  }

  if (context.permissionMode === 'plan') {
    lines.push('- planning mode is active: do not start implementation yet')
    lines.push('- while planning, only read-only tools and plan-file edits are allowed')
    lines.push('- write the plan file with Edit or Write; do not use Bash, cat, heredocs, or shell redirection to modify it')
    lines.push(
      '- do not create or update tasks while planning; task tracking begins only when execution starts',
    )
    if (plan?.planFilePath) {
      lines.push('- the plan file is the only file you may edit during planning, and Edit/Write are allowed for that file')
    }
    lines.push("- write the plan file in the same language as the user's latest planning request unless the user asks for another language")
    lines.push('- focus on exploring the codebase, refining the plan, and clarifying ambiguities')
    lines.push(
      '- when the plan is ready, call ExitPlanMode to request the user confirmation flow',
    )
    lines.push('- only a user confirmation choice may leave plan mode or start implementation')
  }

  return lines.join('\n')
}

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
    '- use task boards for current execution state; use memory for durable user, project, and reference knowledge',
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
      ...getMemoryFreshnessLines(entry.updatedAt),
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

export function getUserOverrideSection(context: PromptContext): string | null {
  if (!context.userSystemPrompt) {
    return null
  }

  return ['# User Override', context.userSystemPrompt].join('\n')
}
