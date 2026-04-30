import type { ToolResult } from '../../types/tool.js'
import { createTextMessage } from '../../types/message.js'
import {
  createExecutionTaskBoardForSession,
  loadActiveExecutionTaskBoardForSession,
} from '../../taskboard/store.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './taskCreatePrompt.js'

type TaskDraftInput = {
  subject: string
  description: string
  activeForm?: string
  metadata?: Record<string, unknown>
}

export type TaskCreateInput = {
  board?: {
    title?: string
    purpose?: string
    background?: string
    plan?: string
    scope?: string
    verification?: string
  }
  tasks: TaskDraftInput[]
}

export type TaskCreateOutput = {
  tasks: Array<{
    id: string
    subject: string
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  }>
}

type NormalizedTaskDraft = {
  subject: string
  description: string
  activeForm?: string
  metadata?: Record<string, unknown>
}

const MIN_TASKS_FOR_TRACKING = 3

const MIN_TASK_BOARD_TASKS_ERROR =
  'TaskCreate should only be used when starting an execution task list with at least 3 concrete tasks. If the work breaks into fewer than 3 tasks, skip task tracking.'

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function normalizeTaskDraft(
  value: unknown,
  label: string,
): { ok: true; task: NormalizedTaskDraft } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: `${label} must be an object with non-empty subject and description`,
    }
  }

  const raw = value as {
    subject?: unknown
    description?: unknown
    activeForm?: unknown
    metadata?: unknown
  }

  const subject = normalizeOptionalString(raw.subject)
  if (!subject) {
    return {
      ok: false,
      error: `${label} requires a non-empty subject string`,
    }
  }

  const description = normalizeOptionalString(raw.description)
  if (!description) {
    return {
      ok: false,
      error: `${label} requires a non-empty description string`,
    }
  }

  return {
    ok: true,
    task: {
      subject,
      description,
      activeForm: normalizeOptionalString(raw.activeForm),
      metadata:
        typeof raw.metadata === 'object' &&
        raw.metadata !== null &&
        !Array.isArray(raw.metadata)
          ? (raw.metadata as Record<string, unknown>)
          : undefined,
    },
  }
}

function parseTaskCreateInput(
  input: TaskCreateInput,
): { ok: true; tasks: NormalizedTaskDraft[] } | { ok: false; error: string } {
  if (!Array.isArray(input.tasks)) {
    return {
      ok: false,
      error:
        'TaskCreate requires a tasks[] array. This tool no longer supports single-task creation.',
    }
  }

  if (input.tasks.length < MIN_TASKS_FOR_TRACKING) {
    return {
      ok: false,
      error: MIN_TASK_BOARD_TASKS_ERROR,
    }
  }

  const tasks: NormalizedTaskDraft[] = []
  for (const [index, task] of input.tasks.entries()) {
    const normalized = normalizeTaskDraft(task, `TaskCreate tasks[${index}]`)
    if (!normalized.ok) {
      return normalized
    }
    tasks.push(normalized.task)
  }

  return { ok: true, tasks }
}

function buildExecutionFollowThroughReminder(
  tasks: Array<{
    id: string
    subject: string
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  }>,
) {
  const taskLines = tasks.map(task => `- #${task.id} [${task.status}] ${task.subject}`)
  return createTextMessage(
    'user',
    `<system-reminder>
You just started a fresh execution task list for this turn.

Execution has already started. The first task is already in_progress. Continue implementation in this same turn until every task reaches a terminal state, unless you must interrupt for AskUserQuestion or permission handling.

Current tasks:
${taskLines.join('\n')}
</system-reminder>`,
  )
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
      board: {
        type: 'object',
        description:
          'Optional execution-board brief for the current short-lived work batch.',
        properties: {
          title: { type: 'string' },
          purpose: { type: 'string' },
          background: { type: 'string' },
          plan: { type: 'string' },
          scope: { type: 'string' },
          verification: { type: 'string' },
        },
        additionalProperties: false,
      },
      tasks: {
        type: 'array',
        description:
          'Start a fresh execution task list with 3 or more concrete tasks. The first task will immediately enter in_progress.',
        minItems: MIN_TASKS_FOR_TRACKING,
        items: {
          type: 'object',
          properties: {
            subject: {
              type: 'string',
              description: 'A brief actionable title for the task.',
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
      },
    },
    required: ['tasks'],
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
          },
          required: ['id', 'subject', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
  isReadOnly() {
    // Task tracking still uses internal state updates and remains allowed
    // anywhere the tool is exposed. Hard plan-mode blocking is handled
    // separately from this runtime path.
    return true
  },
  async validate(input, context) {
    if (!context.sessionId) {
      return {
        ok: false,
        error: 'TaskCreate requires an active sessionId in tool context',
      }
    }

    const parsed = parseTaskCreateInput(input)
    if (!parsed.ok) {
      return parsed
    }

    const existingBoard = await loadActiveExecutionTaskBoardForSession(context.sessionId)
    if (existingBoard) {
      return {
        ok: false,
        error:
          'TaskCreate cannot start a new task list while another execution task list is still attached to this turn.',
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<TaskCreateOutput>> {
    if (!context.sessionId) {
      throw new Error('TaskCreate requires an active sessionId in tool context')
    }

    const parsed = parseTaskCreateInput(input)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }

    const result = await createExecutionTaskBoardForSession(
      context.sessionId,
      context.cwd,
      parsed.tasks,
      process.env,
      {
        board: input.board,
      },
    )

    const outputTasks = result.tasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
    }))

    context.activeExecutionTaskBoardIdThisTurn = result.board.boardId

    const activeTask = outputTasks.find(task => task.status === 'in_progress')
    const activeSummary = activeTask
      ? ` Execution has started with task #${activeTask.id} ${activeTask.subject}.`
      : ''

    return {
      ok: true,
      output: {
        tasks: outputTasks,
      },
      summary: `Created ${outputTasks.length} execution tasks successfully: ${outputTasks.map(task => `#${task.id} ${task.subject}`).join(', ')}.${activeSummary} Continue implementation in this same turn until the task list reaches terminal states or you must hand control back to the user.`,
      newMessages: [buildExecutionFollowThroughReminder(outputTasks)],
    }
  },
  mapToolResult(result) {
    return result.summary ?? result.output
  },
})
