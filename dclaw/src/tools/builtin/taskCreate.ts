import type { ToolResult } from '../../types/tool.js'
import { createSessionTask } from '../../tasks/store.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './taskCreatePrompt.js'

export type TaskCreateInput = {
  subject: string
  description: string
  activeForm?: string
  metadata?: Record<string, unknown>
}

export type TaskCreateOutput = {
  task: {
    id: string
    subject: string
  }
}

export const taskCreateTool: Tool<TaskCreateInput, TaskCreateOutput> = buildTool({
  name: 'TaskCreate',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'A brief title for the task.',
      },
      description: {
        type: 'string',
        description: 'What needs to be done.',
      },
      activeForm: {
        type: 'string',
        description:
          'Present continuous form shown when in_progress, such as "Running tests".',
      },
      metadata: {
        type: 'object',
        description: 'Arbitrary metadata to attach to the task.',
        additionalProperties: true,
      },
    },
    required: ['subject', 'description'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['id', 'subject'],
        additionalProperties: false,
      },
    },
    required: ['task'],
    additionalProperties: false,
  },
  isReadOnly() {
    // Internal execution-state updates remain available during plan mode.
    return true
  },
  validate(input, context) {
    if (
      typeof input.subject !== 'string' ||
      input.subject.trim().length === 0
    ) {
      return {
        ok: false,
        error: 'TaskCreate requires a non-empty subject string',
      }
    }

    if (
      typeof input.description !== 'string' ||
      input.description.trim().length === 0
    ) {
      return {
        ok: false,
        error: 'TaskCreate requires a non-empty description string',
      }
    }

    if (!context.sessionId) {
      return {
        ok: false,
        error: 'TaskCreate requires an active sessionId in tool context',
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<TaskCreateOutput>> {
    if (!context.sessionId) {
      throw new Error('TaskCreate requires an active sessionId in tool context')
    }

    const result = await createSessionTask(context.sessionId, context.cwd, {
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      metadata: input.metadata,
    })

    return {
      ok: true,
      output: {
        task: {
          id: result.task.id,
          subject: result.task.subject,
        },
      },
      summary: `Task #${result.task.id} created successfully: ${result.task.subject}`,
    }
  },
  mapToolResult(result) {
    return result.summary ?? result.output
  },
})
