import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getSessionExecutionTaskBoardPath } from '../session/paths.js'
import { loadSessionMeta } from '../session/store.js'
import {
  computeExecutionState,
  createTaskRecord,
  getTaskActiveText,
  hasUnfinishedTasks,
} from './state.js'
import type {
  TaskBoard,
  TaskBoardBrief,
  TaskBoardEndReason,
  TaskRecord,
  TaskStatus,
} from './types.js'

type TaskBoardDraftInput = {
  subject: string
  description: string
  activeForm?: string
  metadata?: Record<string, unknown>
}

type TaskBoardUpdateInput = {
  subject?: string
  description?: string
  activeForm?: string
  status?: TaskStatus
  owner?: string
  addBlocks?: string[]
  addBlockedBy?: string[]
  metadata?: Record<string, unknown>
}

function nowIso(): string {
  return new Date().toISOString()
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, 'utf8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function normalizeBrief(brief: TaskBoardBrief | undefined): TaskBoardBrief {
  return {
    title: normalizeOptionalString(brief?.title),
    purpose: normalizeOptionalString(brief?.purpose),
    background: normalizeOptionalString(brief?.background),
    plan: normalizeOptionalString(brief?.plan),
    scope: normalizeOptionalString(brief?.scope),
    verification: normalizeOptionalString(brief?.verification),
  }
}

function normalizeTaskRecord(task: TaskRecord & { title?: string }): TaskRecord {
  const subject =
    normalizeOptionalString(task.subject) ??
    normalizeOptionalString(task.title) ??
    'Untitled task'

  return {
    id: normalizeOptionalString(task.id) ?? `task_${randomUUID()}`,
    subject,
    description: normalizeOptionalString(task.description) ?? subject,
    activeForm: normalizeOptionalString(task.activeForm),
    owner: normalizeOptionalString(task.owner),
    status:
      task.status === 'in_progress' ||
      task.status === 'completed' ||
      task.status === 'cancelled'
        ? task.status
        : 'pending',
    blocks: Array.isArray(task.blocks) ? task.blocks : [],
    blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy : [],
    metadata:
      typeof task.metadata === 'object' &&
      task.metadata !== null &&
      !Array.isArray(task.metadata)
        ? task.metadata
        : undefined,
    createdAt: normalizeOptionalString(task.createdAt) ?? nowIso(),
    updatedAt: normalizeOptionalString(task.updatedAt) ?? nowIso(),
  }
}

function normalizeTaskBoard(board: TaskBoard): TaskBoard {
  const brief = normalizeBrief(board)

  return {
    ...brief,
    boardId: normalizeOptionalString(board.boardId) ?? `taskboard_${randomUUID()}`,
    workspaceId: board.workspaceId,
    rootSessionId: board.rootSessionId,
    latestSessionId: board.latestSessionId,
    createdAt: normalizeOptionalString(board.createdAt) ?? nowIso(),
    updatedAt: normalizeOptionalString(board.updatedAt) ?? nowIso(),
    executionState:
      board.executionState === 'active' ||
      board.executionState === 'completed' ||
      board.executionState === 'cancelled'
        ? board.executionState
        : 'idle',
    executionStartedAt: normalizeOptionalString(board.executionStartedAt),
    executionEndedAt: normalizeOptionalString(board.executionEndedAt),
    executionEndReason:
      board.executionEndReason === 'completed' ||
      board.executionEndReason === 'assistant_handoff' ||
      board.executionEndReason === 'permission_denied' ||
      board.executionEndReason === 'abort' ||
      board.executionEndReason === 'llm_error' ||
      board.executionEndReason === 'max_iterations'
        ? board.executionEndReason
        : undefined,
    currentTaskId: normalizeOptionalString(board.currentTaskId),
    currentStep: normalizeOptionalString(board.currentStep),
    tasks: Array.isArray(board.tasks) ? board.tasks.map(normalizeTaskRecord) : [],
  }
}

async function writeTaskBoard(
  board: TaskBoard,
  env: NodeJS.ProcessEnv,
  sessionId: string,
): Promise<void> {
  const path = getSessionExecutionTaskBoardPath(sessionId, board.workspaceId, env)
  await ensureDirectory(dirname(path))
  await writeFile(path, JSON.stringify(board, null, 2) + '\n', 'utf8')
}

async function updateTaskBoard(
  sessionId: string,
  updater: (board: TaskBoard) => TaskBoard,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  const current = await loadExecutionTaskBoardForSession(sessionId, env)
  if (!current) {
    return null
  }

  const next = normalizeTaskBoard(updater(current))
  await writeTaskBoard(next, env, sessionId)
  return next
}

function getCurrentStep(board: TaskBoard): string | undefined {
  const currentTask = board.tasks.find(task => task.status === 'in_progress')
  return currentTask ? getTaskActiveText(currentTask) : undefined
}

function mergeMetadata(
  existing: Record<string, unknown> | undefined,
  updates: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      delete merged[key]
    } else {
      merged[key] = value
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function withBlockedRelation(
  tasks: TaskRecord[],
  fromTaskId: string,
  toTaskId: string,
): TaskRecord[] {
  return tasks.map(task => {
    if (task.id === fromTaskId) {
      return task.blocks.includes(toTaskId)
        ? task
        : { ...task, blocks: [...task.blocks, toTaskId] }
    }
    if (task.id === toTaskId) {
      return task.blockedBy.includes(fromTaskId)
        ? task
        : { ...task, blockedBy: [...task.blockedBy, fromTaskId] }
    }
    return task
  })
}

export async function loadExecutionTaskBoardForSession(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  const meta = await loadSessionMeta(sessionId, env)
  if (!meta) {
    return null
  }

  const sessionRaw = await readJsonFile<TaskBoard>(
    getSessionExecutionTaskBoardPath(sessionId, meta.cwd, env),
  )
  return sessionRaw ? normalizeTaskBoard(sessionRaw) : null
}

export async function loadActiveExecutionTaskBoardForSession(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  const board = await loadExecutionTaskBoardForSession(sessionId, env)
  return isExecutionBoardActive(board) ? board : null
}

export async function createExecutionTaskBoardForSession(
  sessionId: string,
  workspaceId: string,
  inputs: TaskBoardDraftInput[],
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    board?: TaskBoardBrief
  },
): Promise<{
  board: TaskBoard
  tasks: TaskRecord[]
}> {
  env.DCLAW_WORKSPACE_ROOT = workspaceId
  const existing = await loadActiveExecutionTaskBoardForSession(sessionId, env)
  if (existing) {
    throw new Error(
      `TaskCreate cannot start a new task list while execution board ${existing.boardId} is still attached to this turn.`,
    )
  }

  const now = nowIso()
  let nextId = 0
  const tasks = inputs.map((input, index) => {
    nextId += 1
    const base = createTaskRecord(input.subject, now, {
      id: String(nextId),
      description: input.description,
      activeForm: input.activeForm,
      metadata: input.metadata,
    })
    return {
      ...base,
      status: index === 0 ? 'in_progress' : 'pending',
    } satisfies TaskRecord
  })

  const firstTask = tasks[0]
  if (!firstTask) {
    throw new Error('TaskCreate requires at least 3 concrete tasks')
  }

  const brief = normalizeBrief(options?.board)
  const board: TaskBoard = normalizeTaskBoard({
    boardId: `taskboard_${randomUUID()}`,
    workspaceId,
    rootSessionId: sessionId,
    latestSessionId: sessionId,
    ...brief,
    executionState: 'active',
    executionStartedAt: now,
    currentTaskId: firstTask.id,
    currentStep: getTaskActiveText(firstTask),
    createdAt: now,
    updatedAt: now,
    tasks,
  })

  await writeTaskBoard(board, env, sessionId)
  return {
    board,
    tasks,
  }
}

export async function listExecutionSessionTasks(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  board: TaskBoard | null
  tasks: TaskRecord[]
}> {
  const board = await loadActiveExecutionTaskBoardForSession(sessionId, env)
  if (!board) {
    return {
      board: null,
      tasks: [],
    }
  }

  const completedIds = new Set(
    board.tasks.filter(task => task.status === 'completed').map(task => task.id),
  )

  return {
    board,
    tasks: board.tasks.map(task => ({
      ...task,
      blockedBy: task.blockedBy.filter(id => !completedIds.has(id)),
    })),
  }
}

export async function getExecutionSessionTask(
  sessionId: string,
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  board: TaskBoard | null
  task: TaskRecord | null
}> {
  const board = await loadExecutionTaskBoardForSession(sessionId, env)
  if (!board) {
    return {
      board: null,
      task: null,
    }
  }

  return {
    board,
    task: board.tasks.find(task => task.id === taskId) ?? null,
  }
}

export async function updateExecutionSessionTask(
  sessionId: string,
  taskId: string,
  input: TaskBoardUpdateInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  board: TaskBoard | null
  success: boolean
  taskId: string
  updatedFields: string[]
  error?: string
  statusChange?: {
    from: string
    to: string
  }
}> {
  const board = await loadExecutionTaskBoardForSession(sessionId, env)
  if (!board) {
    return {
      board: null,
      success: false,
      taskId,
      updatedFields: [],
      error: 'Task not found',
    }
  }

  const existing = board.tasks.find(task => task.id === taskId)
  if (!existing) {
    return {
      board,
      success: false,
      taskId,
      updatedFields: [],
      error: 'Task not found',
    }
  }

  if (
    input.status === 'in_progress' &&
    board.tasks.some(task => task.id !== taskId && task.status === 'in_progress')
  ) {
    const current = board.tasks.find(
      task => task.id !== taskId && task.status === 'in_progress',
    )
    return {
      board,
      success: false,
      taskId,
      updatedFields: [],
      error: current
        ? `Task #${current.id} is already in_progress. Finish or cancel it before starting another task.`
        : 'Another task is already in_progress.',
    }
  }

  const updatedFields: string[] = []
  let statusChange:
    | {
        from: string
        to: string
      }
    | undefined

  let nextTask: TaskRecord = existing

  if (input.subject !== undefined && input.subject !== existing.subject) {
    nextTask = { ...nextTask, subject: input.subject }
    updatedFields.push('subject')
  }
  if (
    input.description !== undefined &&
    input.description !== existing.description
  ) {
    nextTask = { ...nextTask, description: input.description }
    updatedFields.push('description')
  }
  if (
    input.activeForm !== undefined &&
    input.activeForm !== existing.activeForm
  ) {
    nextTask = { ...nextTask, activeForm: input.activeForm }
    updatedFields.push('activeForm')
  }
  if (input.owner !== undefined && input.owner !== existing.owner) {
    nextTask = { ...nextTask, owner: input.owner }
    updatedFields.push('owner')
  }
  if (input.metadata !== undefined) {
    nextTask = {
      ...nextTask,
      metadata: mergeMetadata(existing.metadata, input.metadata),
    }
    updatedFields.push('metadata')
  }
  if (input.status !== undefined && input.status !== existing.status) {
    nextTask = {
      ...nextTask,
      status: input.status,
    }
    updatedFields.push('status')
    statusChange = {
      from: existing.status,
      to: input.status,
    }
  }

  nextTask = {
    ...nextTask,
    updatedAt: nowIso(),
  }

  const updated =
    (await updateTaskBoard(
      sessionId,
      current => {
        let tasks = current.tasks.map(task => (task.id === taskId ? nextTask : task))

        if (input.addBlocks && input.addBlocks.length > 0) {
          const toAdd = input.addBlocks.filter(
            id =>
              id !== taskId &&
              tasks.some(task => task.id === id) &&
              !nextTask.blocks.includes(id),
          )
          for (const blockId of toAdd) {
            tasks = withBlockedRelation(tasks, taskId, blockId)
          }
          if (toAdd.length > 0) {
            updatedFields.push('blocks')
          }
        }

        if (input.addBlockedBy && input.addBlockedBy.length > 0) {
          const toAdd = input.addBlockedBy.filter(
            id =>
              id !== taskId &&
              tasks.some(task => task.id === id) &&
              !nextTask.blockedBy.includes(id),
          )
          for (const blockerId of toAdd) {
            tasks = withBlockedRelation(tasks, blockerId, taskId)
          }
          if (toAdd.length > 0) {
            updatedFields.push('blockedBy')
          }
        }

        const nextExecutionState = computeExecutionState(tasks)
        const nextBoard: TaskBoard = {
          ...current,
          latestSessionId: sessionId,
          tasks,
          executionState: nextExecutionState,
          currentTaskId:
            nextTask.status === 'in_progress'
              ? taskId
              : current.currentTaskId === taskId &&
                  (nextTask.status === 'completed' || nextTask.status === 'cancelled')
                ? undefined
                : current.currentTaskId,
          updatedAt: nowIso(),
        }

        return {
          ...nextBoard,
          currentStep: getCurrentStep(nextBoard),
          ...(nextExecutionState === 'completed' || nextExecutionState === 'cancelled'
            ? {
                executionEndedAt: nextBoard.executionEndedAt ?? nowIso(),
                executionEndReason:
                  nextExecutionState === 'completed'
                    ? ('completed' satisfies TaskBoardEndReason)
                    : nextBoard.executionEndReason,
              }
            : {}),
        }
      },
      env,
    )) ?? board

  return {
    board: updated,
    success: true,
    taskId,
    updatedFields,
    ...(statusChange ? { statusChange } : {}),
  }
}

export async function finalizeExecutionTaskBoardForTurnEnd(
  sessionId: string,
  reason: Exclude<TaskBoardEndReason, 'completed'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  const board = await loadExecutionTaskBoardForSession(sessionId, env)
  if (!board) {
    return null
  }

  const now = nowIso()
  const tasks: TaskRecord[] = board.tasks.map(task => {
    if (task.status === 'pending' || task.status === 'in_progress') {
      return {
        ...task,
        status: 'cancelled',
        updatedAt: now,
      }
    }

    return task
  })
  const nextExecutionState = computeExecutionState(tasks)
  const updated =
    (await updateTaskBoard(
      sessionId,
      current => ({
        ...current,
        latestSessionId: sessionId,
        tasks,
        currentTaskId: undefined,
        currentStep: undefined,
        executionState: nextExecutionState,
        executionEndedAt: current.executionEndedAt ?? now,
        executionEndReason:
          nextExecutionState === 'completed' ? 'completed' : reason,
        updatedAt: now,
      }),
      env,
    )) ?? board
  return updated
}

export function isExecutionBoardActive(board: TaskBoard | null | undefined): boolean {
  return Boolean(board && board.executionState === 'active' && hasUnfinishedTasks(board))
}
