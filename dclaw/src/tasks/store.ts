import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getTaskBoardPath, getTaskBoardsDir } from '../session/paths.js'
import { loadSessionMeta, updateSessionMeta } from '../session/store.js'
import { ensurePlanFileForTaskBoard } from './planFiles.js'
import { createTaskRecord, getTaskActiveText } from './taskState.js'
import type { TaskBoard, TaskRecord } from './types.js'

export type CreateTaskBoardInput = {
  workspaceId: string
  rootSessionId: string
  latestSessionId?: string
  boardId?: string
  env?: NodeJS.ProcessEnv
}

const COMPLETED_TASK_BOARD_RETIRE_DELAY_MS = 5_000

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

function needsTaskBoardMigration(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false
  }

  return Object.hasOwn(raw, 'todos')
}

function normalizeTaskBoard(board: TaskBoard): TaskBoard {
  const { tasks, todos: _legacyTodos, ...rawBoard } = board as TaskBoard & {
    todos?: unknown
  }

  return {
    ...rawBoard,
    planFilePath:
      typeof board.planFilePath === 'string' &&
      board.planFilePath.trim().length > 0
        ? board.planFilePath
        : undefined,
    resumePermissionMode: board.resumePermissionMode,
    currentTaskId:
      typeof board.currentTaskId === 'string' && board.currentTaskId.trim().length > 0
        ? board.currentTaskId
        : undefined,
    currentStep:
      typeof board.currentStep === 'string' && board.currentStep.trim().length > 0
        ? board.currentStep
        : undefined,
    planModeReminderCount:
      typeof board.planModeReminderCount === 'number' &&
      Number.isInteger(board.planModeReminderCount) &&
      board.planModeReminderCount >= 0
        ? board.planModeReminderCount
        : undefined,
    lastPlanModeReminderTurnCount:
      typeof board.lastPlanModeReminderTurnCount === 'number' &&
      Number.isInteger(board.lastPlanModeReminderTurnCount) &&
      board.lastPlanModeReminderTurnCount >= 0
        ? board.lastPlanModeReminderTurnCount
        : undefined,
    hasExitedPlanModeInSession: board.hasExitedPlanModeInSession === true,
    needsPlanModeExitReminder: board.needsPlanModeExitReminder === true,
    enterRequest: board.enterRequest,
    exitRequest: board.exitRequest,
    tasks: Array.isArray(tasks)
      ? tasks.map(normalizeTaskRecord)
      : [],
  }
}

function normalizeTaskRecord(task: TaskRecord & {
  title?: string
}): TaskRecord {
  const subject =
    typeof task.subject === 'string' && task.subject.trim().length > 0
      ? task.subject
      : typeof task.title === 'string' && task.title.trim().length > 0
        ? task.title
        : 'Untitled task'

  return {
    id: task.id,
    subject,
    description:
      typeof task.description === 'string' && task.description.trim().length > 0
        ? task.description
        : subject,
    activeForm:
      typeof task.activeForm === 'string' && task.activeForm.trim().length > 0
        ? task.activeForm
        : undefined,
    owner:
      typeof task.owner === 'string' && task.owner.trim().length > 0
        ? task.owner
        : undefined,
    status:
      task.status === 'in_progress' || task.status === 'completed'
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
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

async function writeTaskBoard(
  board: TaskBoard,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await ensureDirectory(getTaskBoardsDir(env))
  await writeFile(
    getTaskBoardPath(board.boardId, env),
    JSON.stringify(board, null, 2) + '\n',
    'utf8',
  )
}

export async function createTaskBoard(
  input: CreateTaskBoardInput,
): Promise<TaskBoard> {
  const env = input.env ?? process.env
  const boardId = input.boardId ?? `board_${randomUUID()}`
  const existing = await loadTaskBoard(boardId, env)
  if (existing) {
    return existing
  }

  const now = nowIso()
  const board: TaskBoard = {
    boardId,
    workspaceId: input.workspaceId,
    rootSessionId: input.rootSessionId,
    latestSessionId: input.latestSessionId ?? input.rootSessionId,
    mode: 'inactive',
    createdAt: now,
    updatedAt: now,
    tasks: [],
  }

  await writeTaskBoard(board, env)
  return board
}

export async function loadTaskBoard(
  boardId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  const rawBoard = await readJsonFile<unknown>(getTaskBoardPath(boardId, env))
  if (!rawBoard) {
    return null
  }

  const board = normalizeTaskBoard(rawBoard as TaskBoard)
  if (
    board.mode !== 'active' &&
    board.planFilePath &&
    !existsSync(board.planFilePath)
  ) {
    const rewrittenBoard = {
      ...board,
      planFilePath: undefined,
    }
    await writeTaskBoard(rewrittenBoard, env)
    return rewrittenBoard
  }

  if (needsTaskBoardMigration(rawBoard)) {
    const migratedBoard = board
    await writeTaskBoard(migratedBoard, env)
    return migratedBoard
  }

  return board
}

export async function updateTaskBoard(
  boardId: string,
  updater: (board: TaskBoard) => TaskBoard,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  const current = await loadTaskBoard(boardId, env)
  if (!current) {
    return null
  }

  const next = normalizeTaskBoard(updater(current))
  await writeTaskBoard(next, env)
  return next
}

export async function attachTaskBoardToSession(
  sessionId: string,
  boardId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await updateSessionMeta(
    sessionId,
    meta => ({
      ...meta,
      taskBoardId: boardId,
      updatedAt: nowIso(),
    }),
    env,
  )
}

export async function loadTaskBoardForSession(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  const meta = await loadSessionMeta(sessionId, env)
  if (!meta?.taskBoardId) {
    return null
  }

  const board = await loadTaskBoard(meta.taskBoardId, env)
  if (!board) {
    return null
  }

  if (isRetiredCompletedTaskBoard(board)) {
    await detachRetiredTaskBoardFromSession(sessionId, board.boardId, env)
    return null
  }

  return board
}

export async function updateTaskBoardLatestSession(
  boardId: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard | null> {
  return updateTaskBoard(
    boardId,
    board => ({
      ...board,
      latestSessionId: sessionId,
      updatedAt: nowIso(),
    }),
    env,
  )
}

export async function getOrCreateTaskBoardForSession(
  sessionId: string,
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard> {
  const existing = await loadTaskBoardForSession(sessionId, env)
  if (existing) {
    if (existing.latestSessionId !== sessionId) {
      return (
        (await updateTaskBoardLatestSession(existing.boardId, sessionId, env)) ??
        existing
      )
    }
    return existing
  }

  const board = await createTaskBoard({
    workspaceId,
    rootSessionId: sessionId,
    latestSessionId: sessionId,
    env,
  })
  await attachTaskBoardToSession(sessionId, board.boardId, env)
  return board
}

export async function ensureTaskBoardPlanFile(
  board: TaskBoard,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard> {
  const { filePath } = await ensurePlanFileForTaskBoard(board, env)
  if (board.planFilePath === filePath) {
    return board
  }

  return (
    (await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        planFilePath: filePath,
        updatedAt: nowIso(),
      }),
      env,
    )) ?? {
      ...board,
      planFilePath: filePath,
    }
  )
}

function getNextTaskId(tasks: TaskRecord[]): string {
  const highest = tasks.reduce((max, task) => {
    const value = Number.parseInt(task.id, 10)
    return Number.isInteger(value) && value > max ? value : max
  }, 0)

  return String(highest + 1)
}

function getCurrentStepFromBoard(board: TaskBoard): string | undefined {
  const inProgressTask = board.tasks.find(task => task.status === 'in_progress')
  return inProgressTask ? getTaskActiveText(inProgressTask) : undefined
}

function getVisibleTasks(board: TaskBoard): TaskRecord[] {
  return board.tasks.filter(task => !task.metadata?._internal)
}

function isRetiredCompletedTaskBoard(
  board: TaskBoard,
  now = Date.now(),
): boolean {
  if (board.mode !== 'inactive') {
    return false
  }

  const visibleTasks = getVisibleTasks(board)
  if (visibleTasks.length === 0) {
    return false
  }

  if (visibleTasks.some(task => task.status !== 'completed')) {
    return false
  }

  const updatedAt = Date.parse(board.updatedAt)
  if (Number.isNaN(updatedAt)) {
    return false
  }

  return now - updatedAt >= COMPLETED_TASK_BOARD_RETIRE_DELAY_MS
}

async function detachRetiredTaskBoardFromSession(
  sessionId: string,
  boardId: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await updateSessionMeta(
    sessionId,
    meta => ({
      ...meta,
      taskBoardId: meta.taskBoardId === boardId ? undefined : meta.taskBoardId,
      updatedAt: nowIso(),
    }),
    env,
  )
}

export async function createSessionTask(
  sessionId: string,
  workspaceId: string,
  input: {
    subject: string
    description: string
    activeForm?: string
    metadata?: Record<string, unknown>
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  board: TaskBoard
  task: TaskRecord
}> {
  const board = await getOrCreateTaskBoardForSession(sessionId, workspaceId, env)
  const now = nowIso()
  const task = createTaskRecord(input.subject, now, {
    id: getNextTaskId(board.tasks),
    description: input.description,
    activeForm: input.activeForm,
    metadata: input.metadata,
  })

  const updated =
    (await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        latestSessionId: sessionId,
        tasks: [...current.tasks, task],
        updatedAt: now,
      }),
      env,
    )) ?? board

  return {
    board: updated,
    task,
  }
}

export async function createSessionTasks(
  sessionId: string,
  workspaceId: string,
  inputs: Array<{
    subject: string
    description: string
    activeForm?: string
    metadata?: Record<string, unknown>
  }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  board: TaskBoard
  tasks: TaskRecord[]
}> {
  const board = await getOrCreateTaskBoardForSession(sessionId, workspaceId, env)
  if (inputs.length === 0) {
    return {
      board,
      tasks: [],
    }
  }

  const now = nowIso()
  let nextId = board.tasks.reduce((max, task) => {
    const value = Number.parseInt(task.id, 10)
    return Number.isInteger(value) && value > max ? value : max
  }, 0)

  const tasks = inputs.map(input => {
    nextId += 1
    return createTaskRecord(input.subject, now, {
      id: String(nextId),
      description: input.description,
      activeForm: input.activeForm,
      metadata: input.metadata,
    })
  })

  const updated =
    (await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        latestSessionId: sessionId,
        tasks: [...current.tasks, ...tasks],
        updatedAt: now,
      }),
      env,
    )) ?? board

  return {
    board: updated,
    tasks,
  }
}

export async function listSessionTasks(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  board: TaskBoard | null
  tasks: TaskRecord[]
}> {
  const board = await loadTaskBoardForSession(sessionId, env)
  if (!board) {
    return {
      board: null,
      tasks: [],
    }
  }

  const visibleTasks = getVisibleTasks(board)
  const completedIds = new Set(
    visibleTasks.filter(task => task.status === 'completed').map(task => task.id),
  )

  return {
    board,
    tasks: visibleTasks.map(task => ({
      ...task,
      blockedBy: task.blockedBy.filter(id => !completedIds.has(id)),
    })),
  }
}

export async function getSessionTask(
  sessionId: string,
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  board: TaskBoard | null
  task: TaskRecord | null
}> {
  const board = await loadTaskBoardForSession(sessionId, env)
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

export async function updateSessionTask(
  sessionId: string,
  taskId: string,
  input: {
    subject?: string
    description?: string
    activeForm?: string
    status?: 'pending' | 'in_progress' | 'completed' | 'deleted'
    owner?: string
    addBlocks?: string[]
    addBlockedBy?: string[]
    metadata?: Record<string, unknown>
  },
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
  const board = await loadTaskBoardForSession(sessionId, env)
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

  if (input.status === 'deleted') {
    const updated =
      (await updateTaskBoard(
        board.boardId,
        current => {
          const remaining = current.tasks
            .filter(task => task.id !== taskId)
            .map(task => ({
              ...task,
              blocks: task.blocks.filter(id => id !== taskId),
              blockedBy: task.blockedBy.filter(id => id !== taskId),
            }))
          const nextBoard = {
            ...current,
            latestSessionId: sessionId,
            tasks: remaining,
            currentTaskId:
              current.currentTaskId === taskId ? undefined : current.currentTaskId,
            updatedAt: nowIso(),
          }
          return {
            ...nextBoard,
            currentStep: getCurrentStepFromBoard(nextBoard),
          }
        },
        env,
      )) ?? board

    return {
      board: updated,
      success: true,
      taskId,
      updatedFields: ['deleted'],
      statusChange: {
        from: existing.status,
        to: 'deleted',
      },
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
    nextTask = { ...nextTask, status: input.status }
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
      board.boardId,
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

        const nextBoard = {
          ...current,
          latestSessionId: sessionId,
          tasks,
          currentTaskId:
            nextTask.status === 'in_progress'
              ? taskId
              : current.currentTaskId === taskId && nextTask.status === 'completed'
                ? undefined
                : current.currentTaskId,
          updatedAt: nowIso(),
        }

        return {
          ...nextBoard,
          currentStep: getCurrentStepFromBoard(nextBoard),
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
