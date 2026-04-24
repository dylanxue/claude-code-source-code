import { readPlanFile } from '../../tasks/planFiles.js'
import {
  ensureTaskBoardPlanFile,
  loadTaskBoardForSession,
  updateTaskBoard,
} from '../../tasks/store.js'
import { appendPlanSnapshotForFile } from '../../tasks/planSnapshots.js'
import type {
  PermissionMode,
  ToolResult,
} from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './exitPlanModePrompt.js'

export type ExitPlanModeInput = {
  note?: string
}

export type ExitPlanModeOutput = {
  status: 'exited' | 'already_inactive'
  boardId: string
  planFilePath?: string
  resumedPermissionMode?: PermissionMode
  planPreview?: string
  plan?: string
  message?: string
}

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
    'I have organized the plan. If this direction looks good, I can start implementation; if you want changes, tell me what you would like adjusted.'

  if (!planContent || planContent.trim().length === 0) {
    return guidance
  }

  return `Plan:\n${planContent}\n\n${guidance}`
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
        enum: ['exited', 'already_inactive'],
      },
      boardId: {
        type: 'string',
      },
      planFilePath: {
        type: 'string',
      },
      resumedPermissionMode: {
        type: 'string',
        enum: ['default', 'accept-edits', 'bypass-permissions', 'plan'],
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
    },
    required: ['status', 'boardId'],
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

    const loadedBoard = await loadTaskBoardForSession(context.sessionId)
    if (!loadedBoard) {
      throw new Error('ExitPlanMode requires a task board attached to the active session')
    }

    const board = await ensureTaskBoardPlanFile(loadedBoard)
    const planContent =
      board.planFilePath ? await readPlanFile(board.planFilePath) : null
    const planPreview = extractPlanPreview(planContent)

    if (board.mode !== 'active') {
      const resumedPermissionMode =
        board.resumePermissionMode ?? context.permissionMode
      const message = buildPlanDeliveryMessage(planContent)
      return {
        ok: true,
        output: {
          status: 'already_inactive',
          boardId: board.boardId,
          ...(board.planFilePath ? { planFilePath: board.planFilePath } : {}),
          ...(resumedPermissionMode ? { resumedPermissionMode } : {}),
          ...(planPreview ? { planPreview } : {}),
          ...(planContent ? { plan: planContent } : {}),
          message,
        },
        summary: 'Plan mode is already inactive.',
      }
    }

    const resumedPermissionMode = board.resumePermissionMode ?? 'default'
    const updated =
      (await updateTaskBoard(board.boardId, current => ({
        ...current,
        mode: 'inactive',
        exitRequest: undefined,
        latestSessionId: context.sessionId!,
        hasExitedPlanModeInSession: true,
        needsPlanModeExitReminder: true,
        planModeReminderCount: undefined,
        lastPlanModeReminderTurnCount: undefined,
        resumePermissionMode: undefined,
        updatedAt: new Date().toISOString(),
      }))) ?? board

    context.setPermissionMode?.(resumedPermissionMode)
    context.setPlanFilePath?.(undefined)
    await appendPlanSnapshotForFile(
      context.sessionId,
      updated.planFilePath,
      'exit-plan-mode',
    )
    const message = buildPlanDeliveryMessage(planContent)

    return {
      ok: true,
      output: {
        status: 'exited',
        boardId: updated.boardId,
        ...(updated.planFilePath ? { planFilePath: updated.planFilePath } : {}),
        resumedPermissionMode,
        ...(planPreview ? { planPreview } : {}),
        ...(planContent ? { plan: planContent } : {}),
        message,
      },
      summary: `Plan mode exited. Present the plan to the user and wait for the next instruction before starting implementation. Permission mode resumed as ${resumedPermissionMode}.`,
    }
  },
})
