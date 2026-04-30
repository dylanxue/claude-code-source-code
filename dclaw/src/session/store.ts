import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { CompactBoundary } from '../compact/types.js'
import { isPersistedToolResultOutput } from '../core/toolResultBudget.js'
import { getSessionPlanFilePath, readPlanFile, writePlanFile } from '../tasks/planFiles.js'
import type { Message } from '../types/message.js'
import {
  getTranscriptSerializableMessages,
  repairDanglingToolUseMessages,
} from '../types/message.js'
import type { PermissionMode } from '../types/tool.js'
import {
  getProjectSessionsDir,
  getSessionDir,
  getSessionMessagesPath,
  getSessionMetaPath,
} from './paths.js'

export type SessionMode = 'interactive' | 'exec'

export type SessionPersistedToolResultRecord = {
  toolUseId: string
  toolName: string
  filepath: string
  originalSizeChars: number
  recordedAt: string
}

export type PlanModeStatus = 'inactive' | 'active'

export type PlanModeState = {
  status: PlanModeStatus
  planFilePath?: string
  resumePermissionMode?: PermissionMode
  reminderCount?: number
  lastReminderTurnCount?: number
  hasExitedInSession?: boolean
  needsExitReminder?: boolean
  updatedAt?: string
}

export type SessionMeta = {
  sessionId: string
  cwd: string
  mode: SessionMode
  runtimeName?: string
  provider: string
  model?: string
  sessionMemory?: {
    path?: string
    coveredMessageId?: string
    coveredAt?: string
    updatedAt?: string
  }
  planMode?: PlanModeState
  taskBoardId?: string
  listedSkillNames?: string[]
  invokedSkillNames?: string[]
  createdAt: string
  updatedAt: string
  persistedToolResults: SessionPersistedToolResultRecord[]
}

export type CreateSessionInput = {
  cwd: string
  mode: SessionMode
  runtimeName?: string
  provider: string
  model?: string
  taskBoardId?: string
  sessionId?: string
  env?: NodeJS.ProcessEnv
}

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

function normalizeSessionMeta(meta: SessionMeta): SessionMeta {
  const { planBoardId: _legacyPlanBoardId, ...rawMeta } = meta as SessionMeta & {
    planBoardId?: unknown
  }

  return {
    ...rawMeta,
    runtimeName:
      typeof meta.runtimeName === 'string' && meta.runtimeName.trim().length > 0
        ? meta.runtimeName
        : undefined,
    sessionMemory: normalizeSessionMemoryState(meta.sessionMemory),
    planMode: normalizePlanModeState(meta.planMode),
    taskBoardId:
      typeof meta.taskBoardId === 'string' && meta.taskBoardId.trim().length > 0
        ? meta.taskBoardId
        : undefined,
    listedSkillNames: normalizeSkillNameList(meta.listedSkillNames),
    invokedSkillNames: normalizeSkillNameList(meta.invokedSkillNames),
    persistedToolResults: Array.isArray(meta.persistedToolResults)
      ? meta.persistedToolResults
      : [],
  }
}

function normalizeSkillNameList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const names = [
    ...new Set(
      value
        .filter((name): name is string => typeof name === 'string')
        .map(name => name.trim())
        .filter(name => name.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right))

  return names.length > 0 ? names : undefined
}

function normalizeSessionMemoryState(
  state: SessionMeta['sessionMemory'] | undefined,
): SessionMeta['sessionMemory'] | undefined {
  if (!state || typeof state !== 'object') {
    return undefined
  }

  const normalized = {
    path:
      typeof state.path === 'string' && state.path.trim().length > 0
        ? state.path
        : undefined,
    coveredMessageId:
      typeof state.coveredMessageId === 'string' &&
      state.coveredMessageId.trim().length > 0
        ? state.coveredMessageId
        : undefined,
    coveredAt:
      typeof state.coveredAt === 'string' && state.coveredAt.trim().length > 0
        ? state.coveredAt
        : undefined,
    updatedAt:
      typeof state.updatedAt === 'string' && state.updatedAt.trim().length > 0
        ? state.updatedAt
        : undefined,
  }

  return Object.values(normalized).some(value => value !== undefined)
    ? normalized
    : undefined
}

function normalizePlanModeState(
  state: PlanModeState | undefined,
): PlanModeState | undefined {
  if (!state || typeof state !== 'object') {
    return undefined
  }

  const status: PlanModeStatus = state.status === 'active' ? 'active' : 'inactive'
  return {
    status,
    planFilePath:
      typeof state.planFilePath === 'string' &&
      state.planFilePath.trim().length > 0
        ? state.planFilePath
        : undefined,
    resumePermissionMode: state.resumePermissionMode,
    reminderCount:
      typeof state.reminderCount === 'number' &&
      Number.isInteger(state.reminderCount) &&
      state.reminderCount >= 0
        ? state.reminderCount
        : undefined,
    lastReminderTurnCount:
      typeof state.lastReminderTurnCount === 'number' &&
      Number.isInteger(state.lastReminderTurnCount) &&
      state.lastReminderTurnCount >= 0
        ? state.lastReminderTurnCount
        : undefined,
    hasExitedInSession: state.hasExitedInSession === true,
    needsExitReminder: state.needsExitReminder === true,
    updatedAt:
      typeof state.updatedAt === 'string' && state.updatedAt.trim().length > 0
        ? state.updatedAt
        : undefined,
  }
}

function collectPersistedToolResultRecords(
  messages: Message[],
  recordedAt: string,
): SessionPersistedToolResultRecord[] {
  const records: SessionPersistedToolResultRecord[] = []

  for (const message of messages) {
    for (const block of message.content) {
      if (
        block.type === 'tool_result' &&
        isPersistedToolResultOutput(block.output)
      ) {
        records.push({
          toolUseId: block.toolUseId,
          toolName: block.output.toolName,
          filepath: block.output.filepath,
          originalSizeChars: block.output.originalSizeChars,
          recordedAt,
        })
      }
    }
  }

  return records
}

async function writeSessionMeta(
  meta: SessionMeta,
  env: NodeJS.ProcessEnv,
  workspaceRoot?: string,
): Promise<void> {
  const sessionDir = workspaceRoot
    ? getSessionDir(meta.sessionId, workspaceRoot, env)
    : getSessionDir(meta.sessionId, env)
  await ensureDirectory(sessionDir)
  await writeFile(
    join(sessionDir, 'meta.json'),
    JSON.stringify(meta, null, 2) + '\n',
    'utf8',
  )
}

async function ensureSessionMessagesFile(
  sessionId: string,
  env: NodeJS.ProcessEnv,
  workspaceRoot?: string,
): Promise<void> {
  const sessionDir = workspaceRoot
    ? getSessionDir(sessionId, workspaceRoot, env)
    : getSessionDir(sessionId, env)
  await ensureDirectory(sessionDir)
  await appendFile(join(sessionDir, 'messages.jsonl'), '', 'utf8')
}

export async function createSession(
  input: CreateSessionInput,
): Promise<SessionMeta> {
  const env = input.env ?? process.env
  env.DCLAW_WORKSPACE_ROOT = input.cwd
  const sessionId = input.sessionId ?? randomUUID()
  const existing = await readJsonFile<SessionMeta>(
    getSessionMetaPath(sessionId, input.cwd, env),
  )
  if (existing) {
    await ensureSessionMessagesFile(sessionId, env, input.cwd)
    return normalizeSessionMeta(existing)
  }

  await ensureDirectory(getProjectSessionsDir(input.cwd, env))
  const now = new Date().toISOString()
  const meta: SessionMeta = {
    sessionId,
    cwd: input.cwd,
    mode: input.mode,
    runtimeName: input.runtimeName,
    provider: input.provider,
    model: input.model,
    taskBoardId: input.taskBoardId,
    createdAt: now,
    updatedAt: now,
    persistedToolResults: [],
  }

  await writeSessionMeta(meta, env, input.cwd)
  await ensureSessionMessagesFile(sessionId, env, input.cwd)
  return meta
}

export async function loadSessionMeta(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta | null> {
  const meta = await readJsonFile<SessionMeta>(getSessionMetaPath(sessionId, env))
  return meta ? normalizeSessionMeta(meta) : null
}

export async function loadSessionMessages(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Message[]> {
  try {
    const text = await readFile(getSessionMessagesPath(sessionId, env), 'utf8')
    const messages = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as Message)
    return repairDanglingToolUseMessages(messages)
  } catch {
    return []
  }
}

export async function appendSessionMessages(
  sessionId: string,
  messages: Message[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (messages.length === 0) {
    return
  }

  const transcriptMessages = getTranscriptSerializableMessages(messages)
  if (transcriptMessages.length === 0) {
    return
  }

  const safeMessages = repairDanglingToolUseMessages(transcriptMessages)
  await ensureSessionMessagesFile(sessionId, env)
  const serialized = safeMessages
    .map(message => JSON.stringify(message))
    .join('\n')
  await appendFile(
    getSessionMessagesPath(sessionId, env),
    serialized + '\n',
    'utf8',
  )

  const meta = await loadSessionMeta(sessionId, env)
  if (!meta) {
    return
  }

  const now = new Date().toISOString()
  const persistedToolResults = collectPersistedToolResultRecords(safeMessages, now)

  await writeSessionMeta(
    {
      ...meta,
      updatedAt: now,
      persistedToolResults: [
        ...meta.persistedToolResults,
        ...persistedToolResults,
      ],
    },
    env,
  )
}

export async function updateSessionMeta(
  sessionId: string,
  updater: (meta: SessionMeta) => SessionMeta,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta | null> {
  const current = await loadSessionMeta(sessionId, env)
  if (!current) {
    return null
  }

  const next = normalizeSessionMeta(updater(current))
  await writeSessionMeta(next, env)
  return next
}

export async function getSessionPlanMode(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanModeState | undefined> {
  const meta = await loadSessionMeta(sessionId, env)
  return meta?.planMode
}

export async function updateSessionPlanMode(
  sessionId: string,
  updater: (
    planMode: PlanModeState | undefined,
    meta: SessionMeta,
  ) => PlanModeState | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanModeState | undefined> {
  const now = new Date().toISOString()
  const updated = await updateSessionMeta(
    sessionId,
    meta => {
      const planMode = normalizePlanModeState(updater(meta.planMode, meta))
      return {
        ...meta,
        planMode: planMode ? { ...planMode, updatedAt: now } : undefined,
        updatedAt: now,
      }
    },
    env,
  )

  return updated?.planMode
}

export async function ensureSessionPlanFile(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  created: boolean
  filePath: string
}> {
  const meta = await loadSessionMeta(sessionId, env)
  if (!meta) {
    throw new Error(`Session ${sessionId} does not exist`)
  }

  const filePath = meta.planMode?.planFilePath ?? getSessionPlanFilePath(sessionId, env)
  const existing = await readPlanFile(filePath)
  if (existing !== null) {
    await updateSessionPlanMode(
      sessionId,
      planMode => ({
        ...(planMode ?? { status: 'inactive' as const }),
        planFilePath: filePath,
      }),
      env,
    )
    return { created: false, filePath }
  }

  await mkdir(dirname(filePath), { recursive: true })
  await writePlanFile(filePath, buildSessionPlanScaffold(meta))
  await updateSessionPlanMode(
    sessionId,
    planMode => ({
      ...(planMode ?? { status: 'inactive' as const }),
      planFilePath: filePath,
    }),
    env,
  )
  return { created: true, filePath }
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

  const preferredPath = meta.planMode?.planFilePath ?? getSessionPlanFilePath(sessionId, env)
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

  const snapshot = readPlanSnapshotFromMessages(messages)
  const toolResult = readSessionPlanContentFromToolResults(messages, preferredPath)
  const recovered = snapshot ?? toolResult
  if (recovered) {
    const targetPath = preferredPath || recovered.filePath
    await mkdir(dirname(targetPath), { recursive: true })
    await writePlanFile(targetPath, recovered.content)
    await updateSessionPlanMode(
      sessionId,
      planMode => ({
        ...(planMode ?? { status: 'inactive' as const }),
        planFilePath: targetPath,
      }),
      env,
    )
    return targetPath
  }

  if (meta.planMode?.status === 'active' || meta.planMode?.planFilePath) {
    const ensured = await ensureSessionPlanFile(sessionId, env)
    return ensured.filePath
  }

  return undefined
}

function buildSessionPlanScaffold(meta: SessionMeta): string {
  return [
    '# Plan',
    '',
    '## Context',
    `- session: ${meta.sessionId}`,
    `- workspace: ${meta.cwd}`,
    '',
    '## Goal',
    '- Describe the user-approved planning goal.',
    '',
    '## Approach',
    '- Outline the implementation strategy.',
    '',
    '## Files',
    '- List the key files that may need to change.',
    '',
    '## Verification',
    '- Describe how the changes should be validated.',
    '',
  ].join('\n')
}

function parsePlanSnapshotText(text: string): PlanSnapshotRecord | null {
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

export async function countSessions(
  workspaceRoot: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const path = getProjectSessionsDir(workspaceRoot, env)
    await ensureDirectory(path)
    const entries = await readdir(path, { withFileTypes: true })
    return entries.length
  } catch {
    return 0
  }
}
