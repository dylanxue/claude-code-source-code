export type CliMode = 'interactive' | 'print' | 'doctor' | 'resume'

export type CommonCliOptions = {
  cwd: string
  model?: string
  provider: 'stub'
  permissionMode: 'default' | 'accept-edits' | 'bypass-permissions' | 'plan'
  systemPrompt?: string
  verbose: boolean
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
  options: CommonCliOptions
}

export type ParsedCliCommand =
  | InteractiveCommand
  | PrintCommand
  | DoctorCommand
  | ResumeCommand
