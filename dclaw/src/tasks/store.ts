import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getPlanBoardPath, getPlanBoardsDir } from '../session/paths.js'
import { loadSessionMeta, updateSessionMeta } from '../session/store.js'
import { ensurePlanFileForPlanBoard } from './planFiles.js'
import type { PlanBoard } from './types.js'

export type PlanBoardBriefPatch = {
  title?: string
  purpose?: string
  background?: string
  plan?: string
  scope?: string
  verification?: string
}

export type CreatePlanBoardInput = {
  workspaceId: string
  rootSessionId: string
  latestSessionId?: string
  boardId?: string
  brief?: PlanBoardBriefPatch
  env?: NodeJS.ProcessEnv
}

const COMPLETED_PLAN_BOARD_RETIRE_DELAY_MS = 5_000

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

function needsPlanBoardMigration(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false
  }

  return Object.hasOwn(raw, 'todos') || Object.hasOwn(raw, 'planId')
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function normalizePlanBoardBrief(
  brief: PlanBoardBriefPatch | undefined,
): PlanBoardBriefPatch {
  return {
    title: normalizeOptionalString(brief?.title),
    purpose: normalizeOptionalString(brief?.purpose),
    background: normalizeOptionalString(brief?.background),
    plan: normalizeOptionalString(brief?.plan),
    scope: normalizeOptionalString(brief?.scope),
    verification: normalizeOptionalString(brief?.verification),
  }
}

type LegacyPlanTaskRecord = {
  status?: unknown
  metadata?: unknown
}

function normalizePlanBoard(board: PlanBoard): PlanBoard {
  const {
    tasks: _legacyTasks,
    currentTaskId: _legacyCurrentTaskId,
    currentStep: _legacyCurrentStep,
    todos: _legacyTodos,
    planId: _legacyPlanId,
    ...rawBoard
  } = board as PlanBoard & {
    tasks?: unknown
    currentTaskId?: unknown
    currentStep?: unknown
    todos?: unknown
    planId?: unknown
  }
  const brief = normalizePlanBoardBrief(board)

  return {
    ...rawBoard,
    planFilePath:
      typeof board.planFilePath === 'string' &&
      board.planFilePath.trim().length > 0
        ? board.planFilePath
        : undefined,
    title: brief.title,
    purpose: brief.purpose,
    background: brief.background,
    plan: brief.plan,
    scope: brief.scope,
    verification: brief.verification,
    resumePermissionMode: board.resumePermissionMode,
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
  }
}

function isPlanBoardLike(board: unknown): board is PlanBoard {
  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    return false
  }

  return (
    Object.hasOwn(board, 'mode') ||
    Object.hasOwn(board, 'planFilePath') ||
    Object.hasOwn(board, 'resumePermissionMode') ||
    Object.hasOwn(board, 'enterRequest') ||
    Object.hasOwn(board, 'exitRequest')
  )
}

function getVisibleLegacyPlanTasks(board: unknown): LegacyPlanTaskRecord[] {
  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    return []
  }

  const rawTasks = (board as { tasks?: unknown }).tasks
  if (!Array.isArray(rawTasks)) {
    return []
  }

  return rawTasks.filter((task): task is LegacyPlanTaskRecord => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      return false
    }

    const metadata = (task as LegacyPlanTaskRecord).metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return true
    }

    return !('_internal' in metadata) || metadata._internal !== true
  })
}

function isRetiredCompletedLegacyPlanBoard(
  board: unknown,
  now = Date.now(),
): boolean {
  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    return false
  }

  if ((board as { mode?: unknown }).mode !== 'inactive') {
    return false
  }

  const visibleTasks = getVisibleLegacyPlanTasks(board)
  if (visibleTasks.length === 0) {
    return false
  }

  if (visibleTasks.some(task => task.status !== 'completed')) {
    return false
  }

  const updatedAt = Date.parse(
    typeof (board as { updatedAt?: unknown }).updatedAt === 'string'
      ? (board as { updatedAt: string }).updatedAt
      : '',
  )
  if (Number.isNaN(updatedAt)) {
    return false
  }

  return now - updatedAt >= COMPLETED_PLAN_BOARD_RETIRE_DELAY_MS
}

async function writePlanBoard(
  board: PlanBoard,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await ensureDirectory(getPlanBoardsDir(env))
  await writeFile(
    getPlanBoardPath(board.boardId, env),
    JSON.stringify(board, null, 2) + '\n',
    'utf8',
  )
}

export async function createPlanBoard(
  input: CreatePlanBoardInput,
): Promise<PlanBoard> {
  const env = input.env ?? process.env
  const boardId = input.boardId ?? `board_${randomUUID()}`
  const existing = await loadPlanBoard(boardId, env)
  if (existing) {
    return existing
  }

  const now = nowIso()
  const brief = normalizePlanBoardBrief(input.brief)
  const board: PlanBoard = {
    boardId,
    workspaceId: input.workspaceId,
    rootSessionId: input.rootSessionId,
    latestSessionId: input.latestSessionId ?? input.rootSessionId,
    ...brief,
    mode: 'inactive',
    createdAt: now,
    updatedAt: now,
  }

  await writePlanBoard(board, env)
  return board
}

export async function loadPlanBoard(
  boardId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanBoard | null> {
  const rawBoard = await readJsonFile<unknown>(getPlanBoardPath(boardId, env))
  if (!rawBoard) {
    return null
  }

  const board = normalizePlanBoard(rawBoard as PlanBoard)
  if (
    board.mode !== 'active' &&
    board.planFilePath &&
    !existsSync(board.planFilePath)
  ) {
    const rewrittenBoard = {
      ...board,
      planFilePath: undefined,
    }
    await writePlanBoard(rewrittenBoard, env)
    return rewrittenBoard
  }

  if (needsPlanBoardMigration(rawBoard)) {
    await writePlanBoard(board, env)
  }

  return board
}

export async function updatePlanBoard(
  boardId: string,
  updater: (board: PlanBoard) => PlanBoard,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanBoard | null> {
  const current = await loadPlanBoard(boardId, env)
  if (!current) {
    return null
  }

  const next = normalizePlanBoard(updater(current))
  await writePlanBoard(next, env)
  return next
}

async function resolvePlanBoardIdForSession(
  sessionId: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const meta = await loadSessionMeta(sessionId, env)
  if (!meta) {
    return undefined
  }

  if (meta.planBoardId) {
    return meta.planBoardId
  }

  if (!meta.taskBoardId) {
    return undefined
  }

  const legacyBoard = await loadPlanBoard(meta.taskBoardId, env)
  if (!legacyBoard || !isPlanBoardLike(legacyBoard)) {
    return undefined
  }

  await updateSessionMeta(
    sessionId,
    current => ({
      ...current,
      planBoardId: current.planBoardId ?? legacyBoard.boardId,
      updatedAt: nowIso(),
    }),
    env,
  )

  return legacyBoard.boardId
}

export async function attachPlanBoardToSession(
  sessionId: string,
  boardId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await updateSessionMeta(
    sessionId,
    meta => ({
      ...meta,
      planBoardId: boardId,
      updatedAt: nowIso(),
    }),
    env,
  )
}

async function detachRetiredPlanBoardFromSession(
  sessionId: string,
  boardId: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await updateSessionMeta(
    sessionId,
    meta => ({
      ...meta,
      planBoardId:
        meta.planBoardId === boardId ? undefined : meta.planBoardId,
      taskBoardId:
        meta.taskBoardId === boardId ? undefined : meta.taskBoardId,
      updatedAt: nowIso(),
    }),
    env,
  )
}

export async function loadPlanBoardForSession(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanBoard | null> {
  const boardId = await resolvePlanBoardIdForSession(sessionId, env)
  if (!boardId) {
    return null
  }

  const rawBoard = await readJsonFile<unknown>(getPlanBoardPath(boardId, env))
  if (isRetiredCompletedLegacyPlanBoard(rawBoard)) {
    await detachRetiredPlanBoardFromSession(sessionId, boardId, env)
    return null
  }

  const board = await loadPlanBoard(boardId, env)
  if (!board) {
    return null
  }

  return board
}

export async function updatePlanBoardLatestSession(
  boardId: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanBoard | null> {
  return updatePlanBoard(
    boardId,
    board => ({
      ...board,
      latestSessionId: sessionId,
      updatedAt: nowIso(),
    }),
    env,
  )
}

export async function getOrCreatePlanBoardForSession(
  sessionId: string,
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanBoard> {
  const existing = await loadPlanBoardForSession(sessionId, env)
  if (existing) {
    if (existing.latestSessionId !== sessionId) {
      return (
        (await updatePlanBoardLatestSession(existing.boardId, sessionId, env)) ??
        existing
      )
    }
    return existing
  }

  const board = await createPlanBoard({
    workspaceId,
    rootSessionId: sessionId,
    latestSessionId: sessionId,
    env,
  })
  await attachPlanBoardToSession(sessionId, board.boardId, env)
  return board
}

export async function ensurePlanBoardPlanFile(
  board: PlanBoard,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanBoard> {
  const { filePath } = await ensurePlanFileForPlanBoard(board, env)
  if (board.planFilePath === filePath) {
    return board
  }

  return (
    (await updatePlanBoard(
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
