import type { ToolResult } from '../../types/tool.js'
import { getExecutionSessionTask } from '../../taskboard/store.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './taskGetPrompt.js'

export type TaskGetInput = {
  taskId: string
}

export type TaskGetOutput = {
  task: {
    id: string
    subject: string
    description: string
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    blocks: string[]
    blockedBy: string[]
  } | null
}

export const taskGetTool: Tool<TaskGetInput, TaskGetOutput> = buildTool({
  name: 'TaskGet',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to retrieve.',
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      task: {
        anyOf: [
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              subject: { type: 'string' },
              description: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              },
              blocks: {
                type: 'array',
                items: { type: 'string' },
              },
              blockedBy: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: [
              'id',
              'subject',
              'description',
              'status',
              'blocks',
              'blockedBy',
            ],
            additionalProperties: false,
          },
          { type: 'null' },
        ],
      },
    },
    required: ['task'],
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
        error: 'TaskGet requires a non-empty taskId string',
      }
    }

    if (!context.sessionId) {
      return {
        ok: false,
        error: 'TaskGet requires an active sessionId in tool context',
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<TaskGetOutput>> {
    if (!context.sessionId) {
      throw new Error('TaskGet requires an active sessionId in tool context')
    }

    const { task } = await getExecutionSessionTask(context.sessionId, input.taskId)
    if (!task) {
      return {
        ok: true,
        output: {
          task: null,
        },
        summary: 'Task not found',
      }
    }

    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ]
    if (task.blockedBy.length > 0) {
      lines.push(`Blocked by: ${task.blockedBy.map(id => `#${id}`).join(', ')}`)
    }
    if (task.blocks.length > 0) {
      lines.push(`Blocks: ${task.blocks.map(id => `#${id}`).join(', ')}`)
    }

    return {
      ok: true,
      output: {
        task: {
          id: task.id,
          subject: task.subject,
          description: task.description,
          status: task.status,
          blocks: task.blocks,
          blockedBy: task.blockedBy,
        },
      },
      summary: lines.join('\n'),
    }
  },
  mapToolResult(result) {
    return result.summary ?? result.output
  },
})
