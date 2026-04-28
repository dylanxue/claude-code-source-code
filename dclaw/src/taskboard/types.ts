export type TaskBoardBrief = {
  title?: string
  purpose?: string
  background?: string
  plan?: string
  scope?: string
  verification?: string
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

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

export type TaskBoardExecutionState =
  | 'idle'
  | 'active'
  | 'completed'
  | 'cancelled'

export type TaskBoardEndReason =
  | 'completed'
  | 'assistant_handoff'
  | 'permission_denied'
  | 'abort'
  | 'llm_error'
  | 'max_iterations'

export type TaskBoard = TaskBoardBrief & {
  boardId: string
  workspaceId: string
  rootSessionId: string
  latestSessionId: string
  createdAt: string
  updatedAt: string
  executionState: TaskBoardExecutionState
  executionStartedAt?: string
  executionEndedAt?: string
  executionEndReason?: TaskBoardEndReason
  currentTaskId?: string
  currentStep?: string
  tasks: TaskRecord[]
}
