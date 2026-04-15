import type { ClaudeMdEntry } from './claudeMd.js'

export type PromptMode = 'interactive' | 'print'

export type PromptContext = {
  cwd: string
  provider: string
  model?: string
  mode: PromptMode
  userSystemPrompt?: string
  claudeMdEntries: ClaudeMdEntry[]
}
