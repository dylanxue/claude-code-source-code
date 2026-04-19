import { randomUUID } from 'node:crypto'
import {
  ensureTaskBoardPlanFile,
  getOrCreateTaskBoardForSession,
  updateTaskBoard,
} from '../../tasks/store.js'
import { appendPlanSnapshotForFile } from '../../tasks/planSnapshots.js'
import type { PlanModeRequest } from '../../tasks/types.js'
import type { PermissionMode, ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './enterPlanModePrompt.js'

export type EnterPlanModeInput = {
  note?: string
}

export type EnterPlanModeOutput = {
  status: 'approved' | 'rejected' | 'already_active'
  boardId: string
  planFilePath?: string
  resumedPermissionMode?: PermissionMode
}

function createRequest(note?: string): PlanModeRequest {
  return {
    requestId: `plan_enter_${randomUUID()}`,
    requestedBy: 'model',
    createdAt: new Date().toISOString(),
    ...(typeof note === 'string' && note.trim().length > 0
      ? { note: note.trim() }
      : {}),
  }
}

export const enterPlanModeTool: Tool<
  EnterPlanModeInput,
  EnterPlanModeOutput
> = buildTool({
  name: 'EnterPlanMode',
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
          'Optional short reason for why planning mode is needed right now.',
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['approved', 'rejected', 'already_active'],
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
    },
    required: ['status', 'boardId'],
    additionalProperties: false,
  },
  isReadOnly() {
    return true
  },
  isEnabled(context) {
    return Boolean(context.askUserQuestions)
  },
  validate(_input, context) {
    if (!context.sessionId) {
      return {
        ok: false,
        error: 'EnterPlanMode requires an active sessionId in tool context',
      }
    }

    if (!context.askUserQuestions) {
      return {
        ok: false,
        error: 'EnterPlanMode requires interactive user approval support',
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<EnterPlanModeOutput>> {
    if (!context.sessionId || !context.askUserQuestions) {
      throw new Error('EnterPlanMode requires an interactive session context')
    }

    const board = await ensureTaskBoardPlanFile(
      await getOrCreateTaskBoardForSession(context.sessionId, context.cwd),
    )

    if (board.mode === 'active') {
      context.setPermissionMode?.('plan')
      context.setPlanFilePath?.(board.planFilePath)
      return {
        ok: true,
        output: {
          status: 'already_active',
          boardId: board.boardId,
          ...(board.planFilePath ? { planFilePath: board.planFilePath } : {}),
          ...(board.resumePermissionMode
            ? { resumedPermissionMode: board.resumePermissionMode }
            : {}),
        },
        summary: `Plan mode is already active. Continue planning in ${board.planFilePath ?? 'the bound plan file'}.`,
      }
    }

    const request = createRequest(input.note)
    await updateTaskBoard(board.boardId, current => ({
      ...current,
      mode: 'enter_requested',
      enterRequest: request,
      latestSessionId: context.sessionId!,
      planFilePath: board.planFilePath,
      updatedAt: request.createdAt,
    }))

    const answers = await context.askUserQuestions([
      {
        id: 'decision',
        header: 'Plan Mode',
        question:
          typeof input.note === 'string' && input.note.trim().length > 0
            ? `The model wants to enter plan mode: ${input.note.trim()}`
            : 'The model wants to enter plan mode before implementation.',
        options: [
          {
            label: 'Approve',
            description: 'Enter plan mode and keep implementation blocked.',
            preview: board.planFilePath,
          },
          {
            label: 'Reject',
            description: 'Stay in the current execution mode.',
          },
        ],
      },
    ])

    const approved = answers.decision === 'Approve'
    if (!approved) {
      const reverted =
        (await updateTaskBoard(board.boardId, current => ({
          ...current,
          mode: 'inactive',
          enterRequest: undefined,
          latestSessionId: context.sessionId!,
          updatedAt: new Date().toISOString(),
        }))) ?? board

      return {
        ok: true,
        output: {
          status: 'rejected',
          boardId: reverted.boardId,
          ...(reverted.planFilePath ? { planFilePath: reverted.planFilePath } : {}),
          ...(reverted.resumePermissionMode
            ? { resumedPermissionMode: reverted.resumePermissionMode }
            : {}),
        },
        summary: 'Plan mode entry request was rejected by the user.',
      }
    }

    const resumedPermissionMode =
      context.permissionMode === 'plan'
        ? board.resumePermissionMode ?? 'default'
        : context.permissionMode
    const updated =
      (await updateTaskBoard(board.boardId, current => ({
        ...current,
        mode: 'active',
        enterRequest: undefined,
        exitRequest: undefined,
        latestSessionId: context.sessionId!,
        planFilePath: board.planFilePath,
        needsPlanModeExitReminder: false,
        resumePermissionMode: resumedPermissionMode,
        updatedAt: new Date().toISOString(),
      }))) ?? board

    context.setPermissionMode?.('plan')
    context.setPlanFilePath?.(updated.planFilePath)
    await appendPlanSnapshotForFile(
      context.sessionId,
      updated.planFilePath,
      'enter-plan-mode',
    )

    return {
      ok: true,
      output: {
        status: 'approved',
        boardId: updated.boardId,
        ...(updated.planFilePath ? { planFilePath: updated.planFilePath } : {}),
        resumedPermissionMode,
      },
      summary: `Plan mode entered with approval. Use ${updated.planFilePath ?? 'the plan file'} as the source of truth and continue planning instead of implementation.`,
    }
  },
})
