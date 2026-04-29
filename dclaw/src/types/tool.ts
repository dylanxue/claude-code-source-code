import type {
  ImageContentBlock,
  PdfContentBlock,
  Message,
  TextContentBlock,
} from './message.js'
import type { AgentToolRuntime } from '../agent/types.js'
import type { SkillRegistry } from '../skills/registry.js'
import type { InvokedSkillState } from '../skills/state.js'
import type { ResolvedLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import type { QueryTraceSink } from '../core/queryTrace.js'

export type PermissionMode =
  | 'default'
  | 'accept-edits'
  | 'bypass-permissions'
  | 'plan'

export type ToolResultContent = TextContentBlock | ImageContentBlock | PdfContentBlock

export type ToolResult<T = unknown> = {
  ok: boolean
  output: T
  summary?: string
  content?: ToolResultContent[]
  newMessages?: Message[]
}

export type ToolValidationResult =
  | { ok: true }
  | { ok: false; error: string }

export type AskUserQuestionOption = {
  label: string
  description: string
  preview?: string
}

export type AskUserQuestionAnnotation = {
  preview?: string
  notes?: string
}

export type AskUserQuestionAnnotations = Record<
  string,
  AskUserQuestionAnnotation
>

export type AskUserQuestionHostAction =
  | 'submit_answers'
  | 'respond_to_agent'
  | 'finish_plan_interview'

export type AskUserQuestionHostResult = {
  answers: Record<string, string>
  annotations?: AskUserQuestionAnnotations
  action?: AskUserQuestionHostAction
}

export type AskUserQuestion = {
  id?: string
  question: string
  header: string
  preview?: string
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

export type ToolUseIntent = {
  source: 'assistant_text' | 'reasoning' | 'user_request'
  text: string
}

export type ToolRuntimeProfile = Pick<
  ResolvedLlmRuntimeConfig,
  'primary' | 'imageFallback'
>

export type ReloadSkillsResult = {
  reloaded: boolean
  totalSkills: number
  skillNames: string[]
}

export type ToolContext = {
  sessionId?: string
  activeTurnId?: string
  activeExecutionTaskBoardIdThisTurn?: string
  taskTurnHandoffReason?: 'ask_user_handoff' | 'permission_denied'
  currentIteration?: number
  planFilePath?: string
  cwd: string
  availableTools: string[]
  permissionMode: PermissionMode
  readState: Map<string, ReadStateEntry>
  agentRuntime?: AgentToolRuntime
  skillRegistry?: SkillRegistry
  invokedSkills?: InvokedSkillState
  currentUserRequest?: string
  toolUseIntent?: ToolUseIntent
  queryTraceSink?: QueryTraceSink
  runtimeProfile?: ToolRuntimeProfile
  setPermissionMode?: (permissionMode: PermissionMode) => void
  setPlanFilePath?: (planFilePath: string | undefined) => void
  reloadSkills?: () => Promise<ReloadSkillsResult>
  askUserQuestions?: (
    questions: AskUserQuestion[],
    options?: {
      permissionMode?: PermissionMode
      allowPreviewActions?: boolean
    },
  ) => Promise<Record<string, string> | AskUserQuestionHostResult>
}

export function getToolSupportsImageInput(context: {
  runtimeProfile?: ToolRuntimeProfile
}): boolean | undefined {
  return context.runtimeProfile?.primary.modelCapabilities.supportsImageInput
}

export function getToolSupportsPdfInput(context: {
  runtimeProfile?: ToolRuntimeProfile
}): boolean | undefined {
  return context.runtimeProfile?.primary.modelCapabilities.supportsPdfInput
}

export function getToolVisionRuntime(context: {
  runtimeProfile?: ToolRuntimeProfile
}): ToolRuntimeProfile['imageFallback'] | undefined {
  if (context.runtimeProfile?.imageFallback) {
    return context.runtimeProfile.imageFallback
  }
  return undefined
}
