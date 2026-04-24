import { getCurrentTask } from './taskState.js'
import type { TaskBoard } from './types.js'

type PlanModeToolOutput = {
  status?: string
  planFilePath?: unknown
  resumedPermissionMode?: unknown
}

type PlanModeToolRawOutput = {
  summary?: unknown
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function getPlanFilePath(output: unknown): string | undefined {
  if (typeof output !== 'object' || output === null) {
    return undefined
  }

  return getString((output as PlanModeToolOutput).planFilePath)
}

export function isSystemReminderText(text: string): boolean {
  return text.startsWith('<system-reminder>')
}

export function unwrapSystemReminderText(text: string): string {
  return text
    .replace(/^<system-reminder>\s*/u, '')
    .replace(/\s*<\/system-reminder>$/u, '')
    .trim()
}

export function describeSystemReminderText(text: string): string | undefined {
  if (!isSystemReminderText(text)) {
    return undefined
  }

  const body = unwrapSystemReminderText(text)
  if (body.length === 0) {
    return '[system reminder]'
  }

  const collapsed = body.replace(/\s+/gu, ' ').trim()
  return `[system reminder] ${collapsed}`
}

export function describePlanModeToolUse(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  const note = getString(input.note)

  if (toolName === 'EnterPlanMode') {
    return note
      ? `[plan mode] enter: ${note}`
      : '[plan mode] enter'
  }

  if (toolName === 'ExitPlanMode') {
    return note
      ? `[plan mode] exit: ${note}`
      : '[plan mode] exit'
  }

  return undefined
}

export function describePlanModeToolResult(
  toolName: string | undefined,
  output: unknown,
  rawOutput?: unknown,
): string | undefined {
  if (toolName !== 'EnterPlanMode' && toolName !== 'ExitPlanMode') {
    return undefined
  }

  const status =
    typeof output === 'object' && output !== null
      ? getString((output as PlanModeToolOutput).status)
      : undefined
  const planFilePath = getPlanFilePath(output)
  const resumedPermissionMode =
    typeof output === 'object' && output !== null
      ? getString((output as PlanModeToolOutput).resumedPermissionMode)
      : undefined
  const summary =
    typeof rawOutput === 'object' && rawOutput !== null
      ? getString((rawOutput as PlanModeToolRawOutput).summary)
      : undefined

  if (toolName === 'EnterPlanMode') {
    if (status === 'entered') {
      return planFilePath
        ? `[planning lock] entered: ${planFilePath}`
        : '[planning lock] entered'
    }
    if (status === 'already_active') {
      return planFilePath
        ? `[planning lock] already active: ${planFilePath}`
        : '[planning lock] already active'
    }
  }

  if (toolName === 'ExitPlanMode') {
    if (status === 'exited') {
      return resumedPermissionMode
        ? `[planning lock] exited: ${resumedPermissionMode}`
        : '[planning lock] exited'
    }
    if (status === 'already_inactive') {
      return '[planning lock] already inactive'
    }
  }

  return summary
}

export function getTaskBoardBriefObservationLines(board: TaskBoard): string[] {
  return [
    ...(board.title ? [`board title: ${board.title}`] : []),
    ...(board.purpose ? [`board purpose: ${board.purpose}`] : []),
    ...(board.background ? [`board background: ${board.background}`] : []),
    ...(board.plan ? [`board plan: ${board.plan}`] : []),
    ...(board.scope ? [`board scope: ${board.scope}`] : []),
    ...(board.verification
      ? [`board verification: ${board.verification}`]
      : []),
  ]
}

export function getTaskBoardObservationLines(board: TaskBoard): string[] {
  const currentTask = getCurrentTask(board)

  return [
    `task board: ${board.boardId}`,
    ...getTaskBoardBriefObservationLines(board),
    `plan mode state: ${board.mode}`,
    ...(board.planFilePath ? [`plan file: ${board.planFilePath}`] : []),
    ...(currentTask ? [`current task: ${currentTask.subject}`] : []),
    ...(board.currentStep ? [`current step: ${board.currentStep}`] : []),
  ]
}
