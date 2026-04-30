import { readPlanFile } from '../../planboard/planFiles.js'
import { appendPlanSnapshotForFile } from '../../planboard/planSnapshots.js'
import {
  loadSessionMeta,
  updateSessionPlanMode,
} from '../../session/store.js'
import { createTextMessage, type Message } from '../../types/message.js'
import type { PermissionMode, ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './exitPlanModePrompt.js'

export type ExitPlanModeInput = {
  note?: string
}

export type ExitPlanModeOutput = {
  status:
    | 'confirmation_requested'
    | 'already_inactive'
    | 'accepted_implement'
    | 'accepted_clear_context'
    | 'kept_planning'
  sessionId: string
  planFilePath?: string
  planPreview?: string
  plan?: string
  message?: string
  confirmationOptions?: string[]
  resumedPermissionMode?: PermissionMode
  clearContextRequested?: boolean
}

const ACCEPT_AND_IMPLEMENT = 'Accept and implement'
const ACCEPT_CLEAR_CONTEXT = 'Accept, clear context and implement'
const KEEP_PLANNING = 'Keep planning'
const CONFIRMATION_OPTIONS = [
  ACCEPT_AND_IMPLEMENT,
  ACCEPT_CLEAR_CONTEXT,
  KEEP_PLANNING,
]

function extractPlanPreview(content: string | null): string | undefined {
  if (!content) {
    return undefined
  }

  return content
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('#'))
}

function buildPlanDeliveryMessage(planContent: string | null): string {
  const guidance =
    'I have organized the plan. Please choose whether to accept and implement it, accept it in a fresh context, or keep planning.'

  if (!planContent || planContent.trim().length === 0) {
    return guidance
  }

  return `Plan:\n${planContent}\n\n${guidance}`
}

function buildApprovedPlanMessage(planContent: string | null): Message {
  return createTextMessage(
    'user',
    [
      'User has approved the plan. You can now start implementation.',
      '',
      'Approved Plan:',
      planContent?.trim() ?? '',
    ].join('\n'),
  )
}

function buildFreshContextPlanMessage(planContent: string | null): Message {
  return createTextMessage(
    'user',
    [
      'Implement the following approved plan:',
      '',
      planContent?.trim() ?? '',
    ].join('\n'),
  )
}

function getPlanDecisionLabel(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined
  }

  const answers = 'answers' in result ? (result as { answers?: unknown }).answers : result
  if (!answers || typeof answers !== 'object') {
    return undefined
  }

  const value = (answers as Record<string, unknown>).exit_plan_mode_decision
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

export const exitPlanModeTool: Tool<
  ExitPlanModeInput,
  ExitPlanModeOutput
> = buildTool({
  name: 'ExitPlanMode',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description:
          'Optional short summary of why the plan is ready to present.',
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: [
          'confirmation_requested',
          'already_inactive',
          'accepted_implement',
          'accepted_clear_context',
          'kept_planning',
        ],
      },
      sessionId: {
        type: 'string',
      },
      planFilePath: {
        type: 'string',
      },
      planPreview: {
        type: 'string',
      },
      plan: {
        type: 'string',
      },
      message: {
        type: 'string',
      },
      confirmationOptions: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      resumedPermissionMode: {
        type: 'string',
        enum: ['default', 'accept-edits', 'bypass-permissions', 'plan'],
      },
      clearContextRequested: {
        type: 'boolean',
      },
    },
    required: ['status', 'sessionId'],
    additionalProperties: false,
  },
  isReadOnly() {
    return true
  },
  isEnabled(context) {
    return Boolean(context.sessionId)
  },
  mapToolResult(result) {
    return result.output
  },
  validate(_input, context) {
    if (!context.sessionId) {
      return {
        ok: false,
        error: 'ExitPlanMode requires an active sessionId in tool context',
      }
    }

    return { ok: true }
  },
  async call(_input, context): Promise<ToolResult<ExitPlanModeOutput>> {
    if (!context.sessionId) {
      throw new Error('ExitPlanMode requires an active session context')
    }

    const meta = await loadSessionMeta(context.sessionId)
    if (!meta) {
      throw new Error('ExitPlanMode requires an active session meta record')
    }

    const planMode = meta.planMode
    const planFilePath =
      planMode?.planFilePath ??
      context.planFilePath
    if (planMode?.status === 'active' && !planFilePath) {
      throw new Error('ExitPlanMode requires an active plan file')
    }
    const planContent = planFilePath ? await readPlanFile(planFilePath) : null
    const planPreview = extractPlanPreview(planContent)

    if (planMode?.status !== 'active') {
      const message = buildPlanDeliveryMessage(planContent)
      return {
        ok: true,
        output: {
          status: 'already_inactive',
          sessionId: context.sessionId,
          ...(planFilePath ? { planFilePath } : {}),
          ...(planPreview ? { planPreview } : {}),
          ...(planContent ? { plan: planContent } : {}),
          message,
        },
        summary: 'Plan mode is already inactive.',
      }
    }

    const message = buildPlanDeliveryMessage(planContent)

    if (!context.askUserQuestions) {
      return {
        ok: true,
        output: {
          status: 'confirmation_requested',
          sessionId: context.sessionId,
          ...(planFilePath ? { planFilePath } : {}),
          ...(planPreview ? { planPreview } : {}),
          ...(planContent ? { plan: planContent } : {}),
          message,
          confirmationOptions: CONFIRMATION_OPTIONS,
        },
        summary:
          'Plan mode exit confirmation requested. Present the plan and wait for the user to choose accept-and-implement, accept-with-fresh-context, or keep-planning.',
      }
    }

    const decisionResult = await context.askUserQuestions(
      [
        {
          id: 'exit_plan_mode_decision',
          header: 'Plan Ready',
          question: 'Choose how to continue with this plan.',
          ...(planContent ? { preview: planContent } : {}),
          options: [
            {
              label: ACCEPT_AND_IMPLEMENT,
              description: 'Exit plan mode and start implementation in this context.',
            },
            {
              label: ACCEPT_CLEAR_CONTEXT,
              description: 'Exit plan mode and request a fresh implementation context.',
            },
            {
              label: KEEP_PLANNING,
              description: 'Stay in plan mode and continue refining the plan.',
            },
          ],
        },
      ],
      {
        permissionMode: 'plan',
        allowPreviewActions: false,
      },
    )

    const decision = getPlanDecisionLabel(decisionResult)
    if (decision === KEEP_PLANNING || !decision) {
      context.setPermissionMode?.('plan')
      context.setPlanFilePath?.(planFilePath)
      return {
        ok: true,
        output: {
          status: 'kept_planning',
          sessionId: context.sessionId,
          ...(planFilePath ? { planFilePath } : {}),
          ...(planPreview ? { planPreview } : {}),
          ...(planContent ? { plan: planContent } : {}),
          message: 'Plan mode remains active. Continue refining the plan file.',
          confirmationOptions: CONFIRMATION_OPTIONS,
        },
        summary: 'User chose to keep planning. Plan mode remains active.',
      }
    }

    const resumedPermissionMode = planMode.resumePermissionMode ?? 'default'
    const updatedPlanMode = await updateSessionPlanMode(
      context.sessionId,
      current => ({
        ...(current ?? planMode),
        status: 'inactive',
        resumePermissionMode: undefined,
        needsExitReminder: decision === ACCEPT_AND_IMPLEMENT,
        hasExitedInSession: true,
        reminderCount: undefined,
        lastReminderTurnCount: undefined,
      }),
    )
    context.setPermissionMode?.(resumedPermissionMode)
    context.setPlanFilePath?.(undefined)
    await appendPlanSnapshotForFile(
      context.sessionId,
      updatedPlanMode?.planFilePath ?? planFilePath,
      'exit-plan-mode-accepted',
    )

    const clearContextRequested = decision === ACCEPT_CLEAR_CONTEXT

    return {
      ok: true,
      output: {
        status: clearContextRequested
          ? 'accepted_clear_context'
          : 'accepted_implement',
        sessionId: context.sessionId,
        ...(planFilePath ? { planFilePath } : {}),
        resumedPermissionMode,
        ...(clearContextRequested ? { clearContextRequested } : {}),
        ...(planPreview ? { planPreview } : {}),
        ...(planContent ? { plan: planContent } : {}),
        message,
        confirmationOptions: CONFIRMATION_OPTIONS,
      },
      summary: clearContextRequested
        ? `Plan approved. Plan mode exited and permission mode resumed as ${resumedPermissionMode}. Fresh-context implementation was requested.`
        : `Plan approved. Plan mode exited and permission mode resumed as ${resumedPermissionMode}. Start implementation now.`,
      newMessages: [
        clearContextRequested
          ? buildFreshContextPlanMessage(planContent)
          : buildApprovedPlanMessage(planContent),
      ],
    }
  },
})
