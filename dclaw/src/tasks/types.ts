import type { PermissionMode } from '../types/tool.js'

export type PlanModeStatus =
  | 'inactive'
  | 'active'
  | 'enter_requested'
  | 'exit_requested'

export type PlanModeRequest = {
  requestId: string
  requestedBy: 'user' | 'model'
  createdAt: string
  note?: string
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'

export type TaskRecord = {
  id: string
  subject: string
  description: string
  activeForm?: string
  owner?: string
  status: TaskStatus
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type TaskBoard = {
  boardId: string
  workspaceId: string
  rootSessionId: string
  latestSessionId: string
  planFilePath?: string
  mode: PlanModeStatus
  resumePermissionMode?: PermissionMode
  createdAt: string
  updatedAt: string
  currentTaskId?: string
  currentStep?: string
  planModeReminderCount?: number
  lastPlanModeReminderTurnCount?: number
  hasExitedPlanModeInSession?: boolean
  needsPlanModeExitReminder?: boolean
  enterRequest?: PlanModeRequest
  exitRequest?: PlanModeRequest
  tasks: TaskRecord[]
}
