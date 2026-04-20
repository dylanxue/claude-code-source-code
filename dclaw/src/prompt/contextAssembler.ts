import type { ClaudeMdEntry } from './claudeMd.js'
import type { PromptContext, PromptMode } from './types.js'

export type PromptContextInput = {
  cwd: string
  provider: string
  model?: string
  mode: PromptMode
  permissionMode?: PromptContext['permissionMode']
  plan?: PromptContext['plan']
  memory?: PromptContext['memory']
  userSystemPrompt?: string
  claudeMdEntries?: ClaudeMdEntry[]
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
    plan: input.plan,
    memory: input.memory,
    userSystemPrompt: input.userSystemPrompt,
    claudeMdEntries: input.claudeMdEntries ?? [],
  }
}
