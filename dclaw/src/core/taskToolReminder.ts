import { createTextMessage, type Message } from '../types/message.js'
import { getCurrentTask } from '../tasks/taskState.js'
import type { TaskBoard } from '../tasks/types.js'

const TASK_CREATE_TOOL_NAME = 'TaskCreate'
const TASK_LIST_TOOL_NAME = 'TaskList'
const TASK_UPDATE_TOOL_NAME = 'TaskUpdate'
const TASK_TOOL_REMINDER_TURN_THRESHOLD = 3
const MAX_TASKS_IN_REMINDER = 5

function hasVisibleTasks(board: TaskBoard): boolean {
  return board.tasks.some(task => !task.metadata?._internal)
}

function hasRequiredTaskTools(availableTools: string[]): boolean {
  return (
    availableTools.includes(TASK_CREATE_TOOL_NAME) &&
    availableTools.includes(TASK_UPDATE_TOOL_NAME)
  )
}

function countAssistantTurnsSinceTaskToolUse(messages: Message[]): number {
  let assistantTurns = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant') {
      continue
    }

    const usedTaskTool = message.content.some(
      block =>
        block.type === 'tool_use' &&
        (block.name === TASK_CREATE_TOOL_NAME ||
          block.name === TASK_UPDATE_TOOL_NAME),
    )
    if (usedTaskTool) {
      return assistantTurns
    }

    assistantTurns += 1
  }

  return assistantTurns
}

function formatTaskListPreview(board: TaskBoard): string[] {
  return board.tasks
    .filter(task => !task.metadata?._internal)
    .slice(0, MAX_TASKS_IN_REMINDER)
    .map(task => {
      const owner = task.owner ? ` (${task.owner})` : ''
      const blocked =
        task.blockedBy.length > 0
          ? ` [blocked by ${task.blockedBy.map(id => `#${id}`).join(', ')}]`
          : ''
      return `- #${task.id} [${task.status}] ${task.subject}${owner}${blocked}`
    })
}

export function buildTaskToolReminderText(
  messages: Message[],
  board: TaskBoard | null | undefined,
  availableTools: string[],
): string | null {
  if (!board || !hasVisibleTasks(board)) {
    return null
  }

  if (!hasRequiredTaskTools(availableTools)) {
    return null
  }

  const assistantTurnsSinceTaskToolUse =
    countAssistantTurnsSinceTaskToolUse(messages)
  if (assistantTurnsSinceTaskToolUse < TASK_TOOL_REMINDER_TURN_THRESHOLD) {
    return null
  }

  const lines = [
    '# Task Tool Reminder',
    `The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using ${TASK_CREATE_TOOL_NAME} to add new tasks and ${TASK_UPDATE_TOOL_NAME} to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. NEVER mention this reminder to the user.`,
    `Use ${TASK_LIST_TOOL_NAME} when you need to review what work is available next.`,
  ]

  const taskPreview = formatTaskListPreview(board)
  if (taskPreview.length > 0) {
    lines.push('Current task list:')
    lines.push(...taskPreview)
  }

  return lines.join('\n')
}

export function buildForcedTaskToolReminderText(
  board: TaskBoard | null | undefined,
  availableTools: string[],
): string | null {
  if (!board || !hasVisibleTasks(board)) {
    return null
  }

  if (!hasRequiredTaskTools(availableTools)) {
    return null
  }

  const lines = [
    '# Task Tool Reminder',
    `The task tools remain available after compaction. If you're working on tasks that would benefit from tracking progress, consider using ${TASK_CREATE_TOOL_NAME} to add new tasks and ${TASK_UPDATE_TOOL_NAME} to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. NEVER mention this reminder to the user.`,
    `Use ${TASK_LIST_TOOL_NAME} when you need to review what work is available next.`,
  ]
  const currentTask = getCurrentTask(board)
  if (currentTask) {
    lines.push(`Current task: #${currentTask.id} [${currentTask.status}] ${currentTask.subject}`)
  }
  if (board.currentStep) {
    lines.push(`Current step: ${board.currentStep}`)
  }

  const taskPreview = formatTaskListPreview(board)
  if (taskPreview.length > 0) {
    lines.push('Current task list:')
    lines.push(...taskPreview)
  }

  return lines.join('\n')
}

export function createTaskToolReminderMessage(
  messages: Message[],
  board: TaskBoard | null | undefined,
  availableTools: string[],
): Message | null {
  const text = buildTaskToolReminderText(messages, board, availableTools)
  if (!text) {
    return null
  }

  return createTextMessage(
    'user',
    `<system-reminder>\n${text}\n</system-reminder>`,
  )
}

export function createForcedTaskToolReminderMessage(
  board: TaskBoard | null | undefined,
  availableTools: string[],
): Message | null {
  const text = buildForcedTaskToolReminderText(board, availableTools)
  if (!text) {
    return null
  }

  return createTextMessage(
    'user',
    `<system-reminder>\n${text}\n</system-reminder>`,
  )
}
