import type { PromptContext, PromptMode } from './types.js'
import type { PromptEnvironmentContext } from './environment.js'

export type PromptContextInput = {
  cwd: string
  provider: string
  model?: string
  mode: PromptMode
  permissionMode?: PromptContext['permissionMode']
  currentDate?: PromptEnvironmentContext['currentDate']
  environment?: PromptContext['environment']
  gitStatus?: PromptContext['gitStatus']
  plan?: PromptContext['plan']
  memory?: PromptContext['memory']
  userSystemPrompt?: string
}

export function assemblePromptContext(
  input: PromptContextInput,
): PromptContext {
  return {
    cwd: input.cwd,
    provider: input.provider,
    model: input.model,
    mode: input.mode,
    permissionMode: input.permissionMode,
    currentDate: input.currentDate,
    environment: input.environment,
    gitStatus: input.gitStatus,
    plan: input.plan,
    memory: input.memory,
    userSystemPrompt: input.userSystemPrompt,
  }
}
