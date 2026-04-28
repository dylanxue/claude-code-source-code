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

export type PlanBoard = {
  boardId: string
  workspaceId: string
  rootSessionId: string
  latestSessionId: string
  planFilePath?: string
  title?: string
  purpose?: string
  background?: string
  plan?: string
  scope?: string
  verification?: string
  mode: PlanModeStatus
  resumePermissionMode?: PermissionMode
  createdAt: string
  updatedAt: string
  planModeReminderCount?: number
  lastPlanModeReminderTurnCount?: number
  hasExitedPlanModeInSession?: boolean
  needsPlanModeExitReminder?: boolean
  enterRequest?: PlanModeRequest
  exitRequest?: PlanModeRequest
}
