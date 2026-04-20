import type { ClaudeMdEntry } from './claudeMd.js'
import type { PermissionMode } from '../types/tool.js'
import type { PlanModeStatus } from '../tasks/types.js'
import type { PromptMemoryContext } from '../memory/prompt.js'

export type PromptMode = 'interactive' | 'print'

export type PlanPromptContext = {
  boardId?: string
  status?: PlanModeStatus
  planFilePath?: string
  currentTaskTitle?: string
  currentStep?: string
  taskSummary?: string[]
}

export type PromptContext = {
  cwd: string
  provider: string
  model?: string
  mode: PromptMode
  permissionMode?: PermissionMode
  plan?: PlanPromptContext
  memory?: PromptMemoryContext
  userSystemPrompt?: string
  claudeMdEntries: ClaudeMdEntry[]
}
