import { resolve } from 'node:path'
import {
  appendSessionMessages,
  ensureSessionPlanFile,
  loadSessionMeta,
  updateSessionPlanMode,
} from '../session/store.js'
import {
  createTranscriptOnlyTextMessage,
  type Message,
} from '../types/message.js'
import {
  getSessionPlanFilePath,
  readPlanFile,
  writePlanFile,
} from './planFiles.js'

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

export function readPlanSnapshotFromMessages(
  messages: Message[],
): PlanSnapshotRecord | null {
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

function readSessionPlanContentFromToolResults(
  messages: Message[],
  planFilePath: string,
): {
  filePath: string
  content: string
} | null {
  const resolvedPlanPath = resolve(planFilePath)
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

      if (resolve(toolOutput.filePath) !== resolvedPlanPath) {
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

export async function recoverSessionPlanFile(
  sessionId: string,
  messages: Message[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const meta = await loadSessionMeta(sessionId, env)
  if (!meta) {
    return undefined
  }

  const preferredPath =
    meta.planMode?.planFilePath ?? getSessionPlanFilePath(sessionId, env)
  const currentContent = await readPlanFile(preferredPath)
  if (currentContent && currentContent.trim().length > 0) {
    await updateSessionPlanMode(
      sessionId,
      planMode => ({
        ...(planMode ?? { status: 'inactive' as const }),
        planFilePath: preferredPath,
      }),
      env,
    )
    return preferredPath
  }

  const planSnapshot = readPlanSnapshotFromMessages(messages)
  const planToolResult = readSessionPlanContentFromToolResults(
    messages,
    preferredPath,
  )
  const recovered = planSnapshot ?? planToolResult

  if (recovered) {
    await writePlanFile(preferredPath, recovered.content)
    await updateSessionPlanMode(
      sessionId,
      planMode => ({
        ...(planMode ?? { status: 'inactive' as const }),
        planFilePath: preferredPath,
      }),
      env,
    )
    return preferredPath
  }

  if (meta.planMode?.status === 'active' || meta.planMode?.planFilePath) {
    const ensured = await ensureSessionPlanFile(sessionId, env)
    return ensured.filePath
  }

  return undefined
}
