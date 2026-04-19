import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { appendSessionMessages } from '../session/store.js'
import {
  createTranscriptOnlyTextMessage,
  type Message,
} from '../types/message.js'
import type { TaskBoard } from './types.js'
import {
  ensurePlanFileForTaskBoard,
  getDefaultPlanFilePath,
  readPlanFile,
} from './planFiles.js'
import { updateTaskBoard } from './store.js'

const PLAN_SNAPSHOT_OPEN = '<plan-file-snapshot>'
const PLAN_SNAPSHOT_CLOSE = '</plan-file-snapshot>'

type PlanSnapshotRecord = {
  filePath: string
  content: string
  capturedAt: string
  reason?: string
}

type ToolResultLike = {
  output?: {
    filePath?: unknown
    content?: unknown
    didWrite?: unknown
  }
}

function serializePlanSnapshot(record: PlanSnapshotRecord): string {
  return [
    PLAN_SNAPSHOT_OPEN,
    JSON.stringify(record),
    PLAN_SNAPSHOT_CLOSE,
  ].join('\n')
}

export function parsePlanSnapshotText(
  text: string,
): PlanSnapshotRecord | null {
  const trimmed = text.trim()
  if (
    !trimmed.startsWith(PLAN_SNAPSHOT_OPEN) ||
    !trimmed.endsWith(PLAN_SNAPSHOT_CLOSE)
  ) {
    return null
  }

  const body = trimmed
    .slice(PLAN_SNAPSHOT_OPEN.length, trimmed.length - PLAN_SNAPSHOT_CLOSE.length)
    .trim()
  if (!body) {
    return null
  }

  try {
    const parsed = JSON.parse(body) as Partial<PlanSnapshotRecord>
    if (
      typeof parsed.filePath !== 'string' ||
      parsed.filePath.trim().length === 0 ||
      typeof parsed.content !== 'string' ||
      parsed.content.trim().length === 0 ||
      typeof parsed.capturedAt !== 'string' ||
      parsed.capturedAt.trim().length === 0
    ) {
      return null
    }

    return {
      filePath: parsed.filePath,
      content: parsed.content,
      capturedAt: parsed.capturedAt,
      ...(typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
        ? { reason: parsed.reason }
        : {}),
    }
  } catch {
    return null
  }
}

export function createPlanSnapshotMessage(
  filePath: string,
  content: string,
  reason?: string,
): Message {
  return createTranscriptOnlyTextMessage(
    'system',
    serializePlanSnapshot({
      filePath,
      content,
      capturedAt: new Date().toISOString(),
      ...(typeof reason === 'string' && reason.trim().length > 0
        ? { reason: reason.trim() }
        : {}),
    }),
  )
}

export function describePlanSnapshotText(text: string): string | undefined {
  const snapshot = parsePlanSnapshotText(text)
  if (!snapshot) {
    return undefined
  }

  const suffix = snapshot.reason ? ` (${snapshot.reason})` : ''
  return `[plan snapshot] ${snapshot.filePath}${suffix}`
}

function readPlanSnapshotFromMessages(messages: Message[]): PlanSnapshotRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    for (const block of message.content) {
      if (block.type !== 'text') {
        continue
      }

      const snapshot = parsePlanSnapshotText(block.text)
      if (snapshot) {
        return snapshot
      }
    }
  }

  return null
}

function isPlanFilePath(
  filePath: string,
  board: TaskBoard,
  env: NodeJS.ProcessEnv,
): boolean {
  const resolvedPath = resolve(filePath)
  const preferredPath = board.planFilePath
    ? resolve(board.planFilePath)
    : undefined

  if (preferredPath) {
    return resolvedPath === preferredPath
  }

  const defaultPath = resolve(getDefaultPlanFilePath(board.boardId, env))
  return resolvedPath === defaultPath
}

function readPlanContentFromToolResults(
  messages: Message[],
  board: TaskBoard,
  env: NodeJS.ProcessEnv,
): {
  filePath: string
  content: string
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') {
      continue
    }

    for (const block of message.content) {
      if (block.type !== 'tool_result') {
        continue
      }

      const rawOutput =
        typeof block.rawOutput === 'object' && block.rawOutput !== null
          ? (block.rawOutput as ToolResultLike)
          : null
      const toolOutput = rawOutput?.output
      if (
        !toolOutput ||
        typeof toolOutput.filePath !== 'string' ||
        typeof toolOutput.content !== 'string' ||
        toolOutput.content.trim().length === 0
      ) {
        continue
      }

      if (!isPlanFilePath(toolOutput.filePath, board, env)) {
        continue
      }

      if (toolOutput.didWrite === false) {
        continue
      }

      return {
        filePath: toolOutput.filePath,
        content: toolOutput.content,
      }
    }
  }

  return null
}

async function writeRecoveredPlanFile(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

export async function appendPlanSnapshotForFile(
  sessionId: string,
  filePath: string | undefined,
  reason?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!filePath) {
    return
  }

  const content = await readPlanFile(filePath)
  if (!content || content.trim().length === 0) {
    return
  }

  await appendSessionMessages(
    sessionId,
    [createPlanSnapshotMessage(filePath, content, reason)],
    env,
  )
}

export async function recoverTaskBoardPlanFile(
  board: TaskBoard,
  messages: Message[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskBoard> {
  const currentContent =
    board.planFilePath ? await readPlanFile(board.planFilePath) : null
  if (currentContent && currentContent.trim().length > 0) {
    return board
  }

  const planSnapshot = readPlanSnapshotFromMessages(messages)
  const planToolResult = readPlanContentFromToolResults(messages, board, env)
  const recovered = planSnapshot ?? planToolResult

  if (recovered) {
    const targetPath =
      board.planFilePath ??
      recovered.filePath ??
      getDefaultPlanFilePath(board.boardId, env)
    await writeRecoveredPlanFile(targetPath, recovered.content)

    if (board.planFilePath === targetPath) {
      return board
    }

    return (
      (await updateTaskBoard(
        board.boardId,
        current => ({
          ...current,
          planFilePath: targetPath,
          updatedAt: new Date().toISOString(),
        }),
        env,
      )) ?? {
        ...board,
        planFilePath: targetPath,
      }
    )
  }

  if (board.mode !== 'active' && !board.planFilePath) {
    return board
  }

  const ensured = await ensurePlanFileForTaskBoard(board, env)
  if (board.planFilePath === ensured.filePath) {
    return board
  }

  return (
    (await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        planFilePath: ensured.filePath,
        updatedAt: new Date().toISOString(),
      }),
      env,
    )) ?? {
      ...board,
      planFilePath: ensured.filePath,
    }
  )
}
