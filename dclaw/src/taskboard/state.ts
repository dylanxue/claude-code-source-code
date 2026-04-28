import { randomUUID } from 'node:crypto'
import type {
  TaskBoard,
  TaskBoardExecutionState,
  TaskRecord,
  TaskStatus,
} from './types.js'

function nowIso(): string {
  return new Date().toISOString()
}

export function createTaskRecord(
  subject: string,
  now: string = nowIso(),
  options: {
    description?: string
    activeForm?: string
    owner?: string
    metadata?: Record<string, unknown>
    id?: string
  } = {},
): TaskRecord {
  return {
    id: options.id ?? `task_${randomUUID()}`,
    subject,
    description: options.description ?? subject,
    activeForm: options.activeForm,
    owner: options.owner,
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: options.metadata,
    createdAt: now,
    updatedAt: now,
  }
}

export function setTaskStatus(
  task: TaskRecord,
  status: TaskStatus,
  now: string = nowIso(),
): TaskRecord {
  return {
    ...task,
    status,
    updatedAt: now,
  }
}

export function getTaskActiveText(task: TaskRecord): string {
  return task.activeForm ?? task.subject
}

export function getCurrentTask(board: TaskBoard): TaskRecord | undefined {
  return board.tasks.find(task => task.id === board.currentTaskId)
}

export function hasUnfinishedTasks(board: TaskBoard): boolean {
  return board.tasks.some(
    task => task.status === 'pending' || task.status === 'in_progress',
  )
}

export function computeExecutionState(
  tasks: TaskRecord[],
): TaskBoardExecutionState {
  if (tasks.length === 0) {
    return 'idle'
  }

  if (
    tasks.some(task => task.status === 'pending' || task.status === 'in_progress')
  ) {
    return 'active'
  }

  if (tasks.every(task => task.status === 'completed')) {
    return 'completed'
  }

  return 'cancelled'
}

