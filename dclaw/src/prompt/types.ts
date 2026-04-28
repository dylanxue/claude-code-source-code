import type { PermissionMode } from '../types/tool.js'
import type { PlanModeStatus } from '../tasks/types.js'
import type { PromptMemoryContext } from '../memory/prompt.js'
import type { PromptEnvironmentContext } from './environment.js'

export type PromptMode = 'interactive' | 'exec'

export type PlanPromptContext = {
  boardId?: string
  status?: PlanModeStatus
  planFilePath?: string
  boardTitle?: string
  boardPurpose?: string
  boardBackground?: string
  boardPlan?: string
  boardScope?: string
  boardVerification?: string
}

export type SkillsRuntimePromptContext = {
  userSkillsDir: string
  projectSkillsDir: string
}

export type PromptContext = {
  cwd: string
  provider: string
  model?: string
  mode: PromptMode
  skillsRuntime?: SkillsRuntimePromptContext
  permissionMode?: PermissionMode
  currentDate?: PromptEnvironmentContext['currentDate']
  environment?: Omit<PromptEnvironmentContext, 'currentDate' | 'gitStatus'>
  gitStatus?: PromptEnvironmentContext['gitStatus']
  plan?: PlanPromptContext
  memory?: PromptMemoryContext
  userSystemPrompt?: string
}
