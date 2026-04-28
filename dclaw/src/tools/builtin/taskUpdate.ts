import type { ToolResult } from '../../types/tool.js'
import { updateExecutionSessionTask } from '../../taskboard/store.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './taskUpdatePrompt.js'

export type TaskUpdateInput = {
  taskId: string
  subject?: string
  description?: string
  activeForm?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  addBlocks?: string[]
  addBlockedBy?: string[]
  owner?: string
  metadata?: Record<string, unknown>
}

export type TaskUpdateOutput = {
  success: boolean
  taskId: string
  updatedFields: string[]
  error?: string
  statusChange?: {
    from: string
    to: string
  }
}

export const taskUpdateTool: Tool<TaskUpdateInput, TaskUpdateOutput> = buildTool({
  name: 'TaskUpdate',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to update.',
      },
      subject: {
        type: 'string',
        description: 'New subject for the task.',
      },
      description: {
        type: 'string',
        description: 'New description for the task.',
      },
      activeForm: {
        type: 'string',
        description:
          'Present continuous form shown when in_progress, such as "Running tests".',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description: 'New status for the task.',
      },
      addBlocks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that this task blocks.',
      },
      addBlockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that block this task.',
      },
      owner: {
        type: 'string',
        description: 'New owner for the task.',
      },
      metadata: {
        type: 'object',
        description:
          'Metadata keys to merge into the task. Set a key to null to delete it.',
        additionalProperties: true,
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      taskId: { type: 'string' },
      updatedFields: {
        type: 'array',
        items: { type: 'string' },
      },
      error: { type: 'string' },
      statusChange: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    required: ['success', 'taskId', 'updatedFields'],
    additionalProperties: false,
  },
  isReadOnly() {
    return true
  },
  validate(input, context) {
    if (
      typeof input.taskId !== 'string' ||
      input.taskId.trim().length === 0
    ) {
      return {
        ok: false,
        error: 'TaskUpdate requires a non-empty taskId string',
      }
    }

    if (!context.sessionId) {
      return {
        ok: false,
        error: 'TaskUpdate requires an active sessionId in tool context',
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<TaskUpdateOutput>> {
    if (!context.sessionId) {
      throw new Error('TaskUpdate requires an active sessionId in tool context')
    }

    const result = await updateExecutionSessionTask(context.sessionId, input.taskId, {
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      status: input.status,
      owner: input.owner,
      addBlocks: input.addBlocks,
      addBlockedBy: input.addBlockedBy,
      metadata: input.metadata,
    })

    let summary: string
    if (!result.success) {
      summary = result.error ?? `Task #${result.taskId} not found`
    } else if (result.statusChange?.to === 'completed') {
      summary = [
        `Task #${result.taskId} marked completed.`,
        'Call TaskList now to find the next available task or confirm that the execution batch has reached terminal states.',
      ].join(' ')
    } else if (result.statusChange?.to === 'in_progress') {
      summary = `Task #${result.taskId} marked in_progress. Continue implementation and keep advancing the current execution batch in this turn.`
    } else if (result.statusChange?.to === 'cancelled') {
      summary = `Task #${result.taskId} marked cancelled.`
    } else {
      summary = `Updated task #${result.taskId} ${result.updatedFields.join(', ')}`
    }

    return {
      ok: true,
      output: {
        success: result.success,
        taskId: result.taskId,
        updatedFields: result.updatedFields,
        ...(result.error ? { error: result.error } : {}),
        ...(result.statusChange ? { statusChange: result.statusChange } : {}),
      },
      summary,
    }
  },
  mapToolResult(result) {
    return result.summary ?? result.output
  },
})
