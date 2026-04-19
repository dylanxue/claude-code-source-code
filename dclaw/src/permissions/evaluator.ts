import type {
  AskUserQuestionHostResult,
  ToolContext,
  ToolValidationResult,
} from '../types/tool.js'
import type { Tool } from '../tools/types.js'
import { getBashManualApprovalReason } from '../tools/builtin/bash.js'
import { resolve } from 'node:path'

type PermissionDecision =
  | { ok: true }
  | { ok: false; error: string }

function describeToolAction(toolName: string, input: unknown): string {
  if (toolName === 'Bash' && typeof input === 'object' && input !== null) {
    const command = 'command' in input ? input.command : undefined
    if (typeof command === 'string' && command.trim().length > 0) {
      return `run command: ${command}`
    }
  }

  if (
    (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') &&
    typeof input === 'object' &&
    input !== null
  ) {
    const filePath = 'file_path' in input ? input.file_path : undefined
    if (typeof filePath === 'string' && filePath.trim().length > 0) {
      return `${toolName} file: ${filePath}`
    }
  }

  return `use tool ${toolName}`
}

async function maybeAskForPermission(
  toolName: string,
  input: unknown,
  context: ToolContext,
  reason?: string,
): Promise<boolean> {
  if (!context.askUserQuestions) {
    return false
  }

  const question = reason
    ? `${reason} Allow dclaw to ${describeToolAction(toolName, input)}?`
    : `Allow dclaw to ${describeToolAction(toolName, input)}?`

  const rawAnswers = await context.askUserQuestions([
    {
      header: 'Permission',
      question,
      options: [
        {
          label: 'Allow',
          description: 'Approve this tool call once.',
        },
        {
          label: 'Reject',
          description: 'Block this tool call.',
        },
      ],
    },
  ])
  const answers =
    rawAnswers &&
    typeof rawAnswers === 'object' &&
    'answers' in rawAnswers &&
    typeof rawAnswers.answers === 'object' &&
    rawAnswers.answers !== null
      ? (rawAnswers as AskUserQuestionHostResult).answers
      : rawAnswers

  return Object.values(answers)[0] === 'Allow'
}

function isFileEditTool(toolName: string): boolean {
  return toolName === 'Edit' || toolName === 'Write'
}

function isPlanFileMutationAllowed(
  tool: Tool,
  input: unknown,
  context: ToolContext,
): boolean {
  if (!isFileEditTool(tool.name) || !context.planFilePath) {
    return false
  }

  if (typeof input !== 'object' || input === null) {
    return false
  }

  const candidate = 'file_path' in input ? input.file_path : undefined
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return false
  }

  return resolve(candidate) === resolve(context.planFilePath)
}

export async function evaluateToolPermission(
  tool: Tool,
  input: unknown,
  context: ToolContext,
): Promise<ToolValidationResult> {
  const isReadOnly = tool.isReadOnly(input)
  const bashApprovalReason =
    tool.name === 'Bash' &&
    typeof input === 'object' &&
    input !== null &&
    'command' in input &&
    typeof input.command === 'string'
      ? getBashManualApprovalReason(input.command)
      : undefined

  if (context.permissionMode === 'bypass-permissions') {
    return { ok: true }
  }

  if (context.permissionMode === 'plan') {
    if (isReadOnly || isPlanFileMutationAllowed(tool, input, context)) {
      return { ok: true }
    }

    return {
      ok: false,
      error:
        'Permission mode plan does not allow mutating tool calls. Exit plan mode or switch permission mode first.',
    }
  }

  if (isReadOnly) {
    return { ok: true }
  }

  if (
    context.permissionMode === 'accept-edits' &&
    isFileEditTool(tool.name)
  ) {
    return { ok: true }
  }

  const allowed = await maybeAskForPermission(
    tool.name,
    input,
    context,
    bashApprovalReason,
  )
  if (allowed) {
    return { ok: true }
  }

  return {
    ok: false,
    error:
      bashApprovalReason ??
      (context.permissionMode === 'accept-edits'
        ? `Permission denied for tool ${tool.name}. In accept-edits mode, only file edits are auto-approved.`
        : `Permission denied for tool ${tool.name} in ${context.permissionMode} mode.`),
  }
}
