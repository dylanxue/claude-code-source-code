import { createSessionTasks, listSessionTasks } from './store.js'

export type PlannedTaskDraft = {
  subject: string
  description: string
}

const SKIPPED_SECTION_HEADINGS = new Set([
  'context',
  'goal',
  'goals',
  'files',
  'verification',
  'scope',
  '技术栈',
  '项目结构',
])

const EXECUTION_SECTION_HINTS = [
  'implementation steps',
  'execution steps',
  'implementation plan',
  'tasks',
  'todo',
  'roadmap',
  'milestones',
  'work plan',
  '实现步骤',
  '执行步骤',
  '任务',
  '待办',
]

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase()
}

function cleanTaskSubjectFromHeading(heading: string): string {
  const trimmed = heading.trim()
  return (
    trimmed
      .replace(/^phase\s+[^\s:：-]+\s*[:：-]\s*/i, '')
      .replace(/^阶段[^\s:：-]*\s*[:：-]\s*/, '')
      .trim() || trimmed
  )
}

function extractHeading(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{2,6})\s+(.*)$/)
  if (!match) {
    return null
  }

  return {
    level: match[1].length,
    text: match[2].trim(),
  }
}

function extractTopLevelListItems(lines: string[]): string[] {
  const items: string[] = []

  for (const rawLine of lines) {
    if (/^\s{2,}/.test(rawLine)) {
      continue
    }

    const match = rawLine.match(/^[-*]\s+(.+)$|^\d+\.\s+(.+)$/)
    if (!match) {
      continue
    }

    const text = (match[1] ?? match[2] ?? '').trim()
    if (text.length === 0) {
      continue
    }

    items.push(text)
  }

  return items
}

function pathContainsExecutionHint(path: string[]): boolean {
  return path.some(part => {
    const normalized = normalizeHeading(part)
    return EXECUTION_SECTION_HINTS.some(hint => normalized.includes(hint))
  })
}

function headingLooksLikeExecutionUnit(heading: string): boolean {
  const normalized = normalizeHeading(heading)
  return (
    /^phase\b/.test(normalized) ||
    /^阶段/.test(heading.trim()) ||
    normalized.includes('milestone') ||
    /^step\s+\d+/i.test(heading.trim()) ||
    normalized.includes('任务')
  )
}

type SectionRecord = {
  heading: string
  level: number
  path: string[]
  lines: string[]
}

function parseSections(planContent: string): SectionRecord[] {
  const sections: SectionRecord[] = []
  const stack: Array<{ level: number; text: string }> = []
  let current: SectionRecord | null = null
  let inCodeFence = false

  for (const rawLine of planContent.split('\n')) {
    if (rawLine.trim().startsWith('```')) {
      inCodeFence = !inCodeFence
      if (current) {
        current.lines.push(rawLine)
      }
      continue
    }

    if (!inCodeFence) {
      const heading = extractHeading(rawLine)
      if (heading) {
        while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
          stack.pop()
        }
        stack.push({ level: heading.level, text: heading.text })
        current = {
          heading: heading.text,
          level: heading.level,
          path: stack.map(item => item.text),
          lines: [],
        }
        sections.push(current)
        continue
      }
    }

    if (current) {
      current.lines.push(rawLine)
    }
  }

  return sections
}

export function extractInitialTasksFromPlan(planContent: string): PlannedTaskDraft[] {
  const sections = parseSections(planContent)
  const drafts: PlannedTaskDraft[] = []

  for (const section of sections) {
    const normalizedHeading = normalizeHeading(section.heading)
    if (SKIPPED_SECTION_HEADINGS.has(normalizedHeading)) {
      continue
    }

    if (!headingLooksLikeExecutionUnit(section.heading)) {
      continue
    }

    const items = extractTopLevelListItems(section.lines)
    if (items.length === 0) {
      continue
    }

    drafts.push({
      subject: cleanTaskSubjectFromHeading(section.heading),
      description: items.map(item => `- ${item}`).join('\n'),
    })
  }

  if (drafts.length > 0) {
    return drafts
  }

  for (const section of sections) {
    const normalizedHeading = normalizeHeading(section.heading)
    if (SKIPPED_SECTION_HEADINGS.has(normalizedHeading)) {
      continue
    }

    if (!pathContainsExecutionHint(section.path)) {
      continue
    }

    const items = extractTopLevelListItems(section.lines)
    for (const item of items) {
      drafts.push({
        subject: item,
        description: item,
      })
    }
  }

  return drafts
}

export async function materializeInitialTasksFromApprovedPlan(
  sessionId: string,
  workspaceId: string,
  planContent: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  createdCount: number
  skippedBecauseTasksExist: boolean
}> {
  const existing = await listSessionTasks(sessionId, env)
  if (existing.tasks.length > 0) {
    return {
      createdCount: 0,
      skippedBecauseTasksExist: true,
    }
  }

  const drafts = extractInitialTasksFromPlan(planContent)
  if (drafts.length === 0) {
    return {
      createdCount: 0,
      skippedBecauseTasksExist: false,
    }
  }

  await createSessionTasks(
    sessionId,
    workspaceId,
    drafts.map(task => ({
      ...task,
      metadata: {
        source: 'approved_plan',
      },
    })),
    env,
  )

  return {
    createdCount: drafts.length,
    skippedBecauseTasksExist: false,
  }
}
