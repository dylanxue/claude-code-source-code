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

export type ReadStateEntry = {
  content: string
  timestamp: number
  isPartialView: boolean
  offset?: number
  limit?: number
}

export type ToolContext = {
  cwd: string
  availableTools: string[]
  permissionMode: PermissionMode
  readState: Map<string, ReadStateEntry>
  askUserQuestions?: (
    questions: Array<{
      question: string
      header: string
      options: Array<{
        label: string
        description: string
      }>
      multiSelect?: boolean
    }>,
  ) => Promise<Record<string, string>>
}
