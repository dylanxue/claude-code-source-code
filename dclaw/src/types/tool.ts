export type PermissionMode =
  | 'default'
  | 'accept-edits'
  | 'bypass-permissions'
  | 'plan'

export type ToolResult<T = unknown> = {
  ok: boolean
  output: T
  summary?: string
}

export type ToolValidationResult =
  | { ok: true }
  | { ok: false; error: string }

export type AskUserQuestionOption = {
  label: string
  description: string
  preview?: string
}

export type AskUserQuestion = {
  id?: string
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect?: boolean
}

export type ReadStateEntry = {
  content: string
  timestamp: number
  isPartialView: boolean
  offset?: number
  limit?: number
}

export type ToolContext = {
  sessionId?: string
  planFilePath?: string
  cwd: string
  availableTools: string[]
  permissionMode: PermissionMode
  readState: Map<string, ReadStateEntry>
  setPermissionMode?: (permissionMode: PermissionMode) => void
  setPlanFilePath?: (planFilePath: string | undefined) => void
  askUserQuestions?: (
    questions: AskUserQuestion[],
  ) => Promise<Record<string, string>>
}
