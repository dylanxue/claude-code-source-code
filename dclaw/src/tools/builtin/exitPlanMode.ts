import { randomUUID } from 'node:crypto'
import { readPlanFile } from '../../tasks/planFiles.js'
import {
  ensureTaskBoardPlanFile,
  loadTaskBoardForSession,
  updateTaskBoard,
} from '../../tasks/store.js'
import type { PlanModeRequest } from '../../tasks/types.js'
import type { PermissionMode, ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'

export type ExitPlanModeInput = {
  note?: string
}

export type ExitPlanModeOutput = {
  status: 'approved' | 'rejected' | 'already_inactive'
  boardId: string
  planFilePath?: string
  resumedPermissionMode?: PermissionMode
  planPreview?: string
}

function createRequest(note?: string): PlanModeRequest {
  return {
    requestId: `plan_exit_${randomUUID()}`,
    requestedBy: 'model',
    createdAt: new Date().toISOString(),
    ...(typeof note === 'string' && note.trim().length > 0
      ? { note: note.trim() }
      : {}),
  }
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

export const exitPlanModeTool: Tool<
  ExitPlanModeInput,
  ExitPlanModeOutput
> = buildTool({
  name: 'ExitPlanMode',
  description:
    'Request to exit plan mode after the plan is ready and ask the user for approval to start implementation.',
  inputSchema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description:
          'Optional short summary of why the plan is ready to implement.',
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['approved', 'rejected', 'already_inactive'],
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
        error: 'ExitPlanMode requires an active sessionId in tool context',
      }
    }

    if (!context.askUserQuestions) {
      return {
        ok: false,
        error: 'ExitPlanMode requires interactive user approval support',
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<ExitPlanModeOutput>> {
    if (!context.sessionId || !context.askUserQuestions) {
      throw new Error('ExitPlanMode requires an interactive session context')
    }

    const loadedBoard = await loadTaskBoardForSession(context.sessionId)
    if (!loadedBoard) {
      throw new Error('ExitPlanMode requires a task board attached to the active session')
    }

    const board = await ensureTaskBoardPlanFile(loadedBoard)
    const planPreview = extractPlanPreview(
      board.planFilePath ? await readPlanFile(board.planFilePath) : null,
    )

    if (board.mode !== 'active') {
      const resumedPermissionMode = board.resumePermissionMode ?? context.permissionMode
      return {
        ok: true,
        output: {
          status: 'already_inactive',
          boardId: board.boardId,
          ...(board.planFilePath ? { planFilePath: board.planFilePath } : {}),
          ...(resumedPermissionMode
            ? { resumedPermissionMode }
            : {}),
          ...(planPreview ? { planPreview } : {}),
        },
        summary: 'Plan mode is already inactive.',
      }
    }

    const request = createRequest(input.note)
    await updateTaskBoard(board.boardId, current => ({
      ...current,
      mode: 'exit_requested',
      exitRequest: request,
      latestSessionId: context.sessionId!,
      updatedAt: request.createdAt,
    }))

    const answers = await context.askUserQuestions([
      {
        id: 'decision',
        header: 'Plan Ready',
        question:
          typeof input.note === 'string' && input.note.trim().length > 0
            ? `The model wants to exit plan mode and start implementation: ${input.note.trim()}`
            : 'The model says the plan is ready and wants to exit plan mode.',
        options: [
          {
            label: 'Approve',
            description: 'Leave plan mode and allow implementation to begin.',
            preview: planPreview,
          },
          {
            label: 'Keep Planning',
            description: 'Stay in plan mode and keep refining the plan.',
          },
        ],
      },
    ])

    if (answers.decision !== 'Approve') {
      const restored =
        (await updateTaskBoard(board.boardId, current => ({
          ...current,
          mode: 'active',
          exitRequest: undefined,
          latestSessionId: context.sessionId!,
          updatedAt: new Date().toISOString(),
        }))) ?? board

      context.setPermissionMode?.('plan')
      context.setPlanFilePath?.(restored.planFilePath)

      return {
        ok: true,
        output: {
          status: 'rejected',
          boardId: restored.boardId,
          ...(restored.planFilePath ? { planFilePath: restored.planFilePath } : {}),
          ...(restored.resumePermissionMode
            ? { resumedPermissionMode: restored.resumePermissionMode }
            : {}),
          ...(planPreview ? { planPreview } : {}),
        },
        summary: 'Plan mode exit request was rejected. Continue planning.',
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

    return {
      ok: true,
      output: {
        status: 'approved',
        boardId: updated.boardId,
        ...(updated.planFilePath ? { planFilePath: updated.planFilePath } : {}),
        resumedPermissionMode,
        ...(planPreview ? { planPreview } : {}),
      },
      summary: `Plan mode exited with approval. Resume implementation in ${resumedPermissionMode} mode.`,
    }
  },
})
