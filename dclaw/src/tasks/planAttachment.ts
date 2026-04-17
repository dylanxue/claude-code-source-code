import { getCurrentTask } from './taskState.js'
import type { TaskBoard } from './types.js'

export function summarizePendingTasks(
  board: TaskBoard,
  limit: number = 5,
): string[] {
  return [...board.tasks]
    .filter(task => task.status === 'in_progress' || task.status === 'pending')
    .sort((left, right) => {
      if (left.status === 'in_progress' && right.status !== 'in_progress') {
        return -1
      }
      if (left.status !== 'in_progress' && right.status === 'in_progress') {
        return 1
      }
      return left.id.localeCompare(right.id, undefined, { numeric: true })
    })
    .slice(0, limit)
    .map(task => `- [${task.status}] ${task.subject}`)
}

export function buildPlanModeAttachmentLines(board: TaskBoard): string[] {
  if (board.mode !== 'active') {
    return []
  }

  const currentTask = getCurrentTask(board)
  const taskSummary = summarizePendingTasks(board)
  const lines = [
    'Plan-mode reminder carried over from the previous session.',
    'Planning is still active.',
    ...(board.planFilePath ? [`plan file: ${board.planFilePath}`] : []),
    ...(currentTask ? [`current task: ${currentTask.subject}`] : []),
    ...(board.currentStep ? [`current step: ${board.currentStep}`] : []),
    'Continue exploring the codebase, refining the plan, and clarifying ambiguities before implementation.',
    'Only read-only tools and plan-file edits are allowed while planning remains active.',
  ]

  if (taskSummary.length > 0) {
    lines.push('pending work summary:')
    lines.push(...taskSummary)
  }

  return lines
}
