import type { ClaudeMdEntry } from './claudeMd.js'
import type { PromptContext, PromptMode } from './types.js'

export type PromptContextInput = {
  cwd: string
  provider: string
  model?: string
  mode: PromptMode
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
    userSystemPrompt: input.userSystemPrompt,
    claudeMdEntries: input.claudeMdEntries ?? [],
  }
}
