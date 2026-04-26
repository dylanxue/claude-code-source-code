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

export function getPlanCenteredWorkflowSection(): string {
  return [
    '# Task-Board Workflow',
    '- Treat task boards as short-lived execution state for the current multi-step work batch.',
    '- A task board should include both a brief work summary and concrete tasks; long-term plans belong in project documents that the user can inspect and co-edit.',
    '- For plan_only requests, such as "give me a plan" or "only discuss the approach", provide the plan in the response and do not enter plan mode or start implementation.',
    '- For implementation_with_planning requests, such as "make a task list and do it", create or update the task board when useful and start execution without entering plan mode.',
    '- EnterPlanMode is only for high_constraint_planning: the user explicitly asks to plan first, avoid code changes, wait for review, or produce a plan before implementation.',
    '- After ExitPlanMode, present the plan and wait for the user to ask for implementation or revisions before taking implementation actions.',
  ].join('\n')
}

export function getLanguageSection(): string {
  return [
    '# Language',
    "- Use the same language as the user's latest message unless they explicitly ask for another language.",
    '- Apply this to visible assistant responses, brief pre-tool progress updates, and any reasoning/thinking summaries when those are exposed.',
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

  if (plan?.boardId) {
    lines.push(`- task board: ${plan.boardId}`)
  }
  if (plan?.boardTitle) {
    lines.push(`- board title: ${plan.boardTitle}`)
  }
  if (plan?.boardPurpose) {
    lines.push(`- board purpose: ${plan.boardPurpose}`)
  }
  if (plan?.boardBackground) {
    lines.push(`- board background: ${plan.boardBackground}`)
  }
  if (plan?.boardPlan) {
    lines.push(`- board plan: ${plan.boardPlan}`)
  }
  if (plan?.boardScope) {
    lines.push(`- board scope: ${plan.boardScope}`)
  }
  if (plan?.boardVerification) {
    lines.push(`- board verification: ${plan.boardVerification}`)
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
    lines.push('- when the plan is ready, call ExitPlanMode to present it and wait for the user')
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
