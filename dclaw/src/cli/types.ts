import type { LlmProviderName } from '../llm/providerNames.js'
import type { PermissionMode } from '../types/tool.js'

export type CliMode = 'interactive' | 'exec' | 'doctor'

export type InteractiveUiMode = 'auto' | 'tui' | 'legacy-repl'

export type CommonCliOptions = {
  cwd: string
  runtime?: string
  provider?: LlmProviderName
  permissionMode?: PermissionMode
  maxIterations?: number
  systemPrompt?: string
  stream: boolean
  interactiveUi?: InteractiveUiMode
}

export type InteractiveCommand = {
  mode: 'interactive'
  prompt?: string
  options: CommonCliOptions
}

export type ExecCommand = {
  mode: 'exec'
  prompt?: string
  options: CommonCliOptions
}

export type DoctorCommand = {
  mode: 'doctor'
  options: CommonCliOptions
}

export type ResumeCommand = {
  mode: 'resume'
  sessionId: string
  prompt?: string
  options: CommonCliOptions
}

export type HistoryCommand = {
  mode: 'history'
  options: CommonCliOptions
}

export type ParsedCliCommand =
  | InteractiveCommand
  | ExecCommand
  | DoctorCommand
