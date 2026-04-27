import type { LlmProviderName } from '../llm/providerNames.js'
import type { PermissionMode } from '../types/tool.js'

export type CliMode = 'interactive' | 'print' | 'doctor' | 'resume' | 'history'

export type InteractiveUiMode = 'auto' | 'tui' | 'legacy-repl'

export type CommonCliOptions = {
  cwd: string
  runtime?: string
  provider?: LlmProviderName
  permissionMode?: PermissionMode
  maxIterations?: number
  systemPrompt?: string
  stream: boolean
  verbose: boolean
  outputFormat: 'text' | 'sse'
  interactiveUi?: InteractiveUiMode
}

export type InteractiveCommand = {
  mode: 'interactive'
  prompt?: string
  options: CommonCliOptions
}

export type PrintCommand = {
  mode: 'print'
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
  | PrintCommand
  | DoctorCommand
  | ResumeCommand
  | HistoryCommand
