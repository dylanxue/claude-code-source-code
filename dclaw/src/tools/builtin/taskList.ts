import type { ToolResult } from '../../types/tool.js'
import { listExecutionSessionTasks } from '../../taskboard/store.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './taskListPrompt.js'

export type TaskListInput = Record<string, never>

export type TaskListOutput = {
  tasks: Array<{
    id: string
    subject: string
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    owner?: string
    blockedBy: string[]
  }>
}

export const taskListTool: Tool<TaskListInput, TaskListOutput> = buildTool({
  name: 'TaskList',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            subject: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
            },
            owner: { type: 'string' },
            blockedBy: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['id', 'subject', 'status', 'blockedBy'],
          additionalProperties: false,
        },
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
  isReadOnly() {
    return true
  },
  validate(_input, context) {
    if (!context.sessionId) {
      return {
        ok: false,
        error: 'TaskList requires an active sessionId in tool context',
      }
    }

    return { ok: true }
  },
  async call(_input, context): Promise<ToolResult<TaskListOutput>> {
    if (!context.sessionId) {
      throw new Error('TaskList requires an active sessionId in tool context')
    }

    const { tasks } = await listExecutionSessionTasks(context.sessionId)
    const outputTasks = tasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      blockedBy: task.blockedBy,
    }))

    const summary =
      outputTasks.length === 0
        ? 'No execution tasks found'
        : outputTasks
            .map(task => {
              const owner = task.owner ? ` (${task.owner})` : ''
              const blocked =
                task.blockedBy.length > 0
                  ? ` [blocked by ${task.blockedBy.map(id => `#${id}`).join(', ')}]`
                  : ''
              return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`
            })
            .join('\n')

    return {
      ok: true,
      output: {
        tasks: outputTasks,
      },
      summary,
    }
  },
  mapToolResult(result) {
    return result.summary ?? result.output
  },
})
