import { existsSync } from 'node:fs'
import {
  getCompactBoundaryMessages,
  getLastCompactBoundary,
  getMessagesAfterCompactBoundary,
} from '../compact/boundaryMessage.js'
import { compactSession } from '../compact/compactSession.js'
import { formatCompactRecommendationLines } from '../compact/pressure.js'
import { formatCompactBoundaryLabel } from '../compact/types.js'
import type { QueryEngine } from '../core/queryEngine.js'
import { loadResolvedLlmConfig } from '../llm/config.js'
import {
  resolveLlmRuntimeConfig,
  type ResolvedLlmRuntimeConfig,
} from '../llm/runtimeConfig.js'
import { listSessionHistory } from '../session/history.js'
import { loadSessionForResume } from '../session/resume.js'
import {
  createSession,
  loadSessionMeta,
  updateSessionMeta,
} from '../session/store.js'
import {
  ensurePlanFileForTaskBoard,
  readPlanFile,
} from '../tasks/planFiles.js'
import {
  appendPlanSnapshotForFile,
  recoverTaskBoardPlanFile,
} from '../tasks/planSnapshots.js'
import {
  getTaskBoardBriefObservationLines,
  getTaskBoardObservationLines,
} from '../tasks/observability.js'
import {
  createTaskRecord,
  getCurrentTask,
  setTaskStatus,
} from '../tasks/taskState.js'
import {
  attachTaskBoardToSession,
  createTaskBoard,
  loadTaskBoard,
  loadTaskBoardForSession,
  updateTaskBoard,
  updateTaskBoardLatestSession,
} from '../tasks/store.js'
import type { TaskBoard } from '../tasks/types.js'
import { formatTranscript } from '../session/transcript.js'
import type { PermissionMode } from '../types/tool.js'
import type { SkillStatus } from '../skills/enablement.js'
import {
  getModelVisibleMessages,
  type Message,
} from '../types/message.js'
import {
  buildConfigAwareEnvWithSources,
} from './configFile.js'
import {
  appendModelLimitLines,
  appendVisionRuntimeLines,
} from './diagnostics.js'
import { ALL_PERMISSION_MODES } from './permissionModeConfig.js'
import type { CommonCliOptions } from './types.js'

function getCurrentModelVisibleMessages(engine: QueryEngine): Message[] {
  return getModelVisibleMessages(engine.getMessages())
}

function formatRuntimeLabel(runtimeName: string | undefined): string {
  return runtimeName ?? 'stub'
}

function formatProviderModelLabel(provider: string, model?: string): string {
  return `${provider}${model ? ` / ${model}` : ''}`
}

export type ReplSessionState = {
  sessionId: string
  mode: 'interactive' | 'resume'
  runtimeName?: string
  provider: string
  providerSource: string
  model?: string
  modelSource: string
  permissionMode: string
  permissionModeSource: string
}

export type ReplCommandContext = {
  engine: QueryEngine
  options: CommonCliOptions
  session: ReplSessionState
  rotateQueryTrace?: (sessionId?: string) => Promise<string | undefined>
  switchRuntime?: (
    runtimeName: string,
  ) => Promise<{
    runtime: ResolvedLlmRuntimeConfig
    queryTracePath?: string
  }>
  listSkillStatuses?: () => Promise<SkillStatus[]>
  setSkillEnabled?: (
    skillName: string,
    enabled: boolean,
  ) => Promise<SkillStatus[]>
}

export type ReplCommandPresentationKind =
  | 'assistant_note'
  | 'structured_card'

export type ReplCommandArgKind =
  | 'none'
  | 'freeform'
  | 'enum'

type ReplCommandDefinition = {
  name: string
  aliases?: string[]
  displayName?: string
  description: string
  argumentHint?: string
  argKind?: ReplCommandArgKind
  canRunWhileBusy?: boolean
  presentationKind?: ReplCommandPresentationKind
  presentationTitle?: string
  handle: (
    args: string[],
    context: ReplCommandContext,
  ) => Promise<void> | void
}

export type ReplCommandCatalogItem = {
  name: string
  aliases?: string[]
  displayName: string
  description: string
  argumentHint?: string
  argKind: ReplCommandArgKind
  canRunWhileBusy?: boolean
  presentationKind: ReplCommandPresentationKind
  presentationTitle?: string
}

let activeOutputWriter: ((text: string) => void) | undefined

function writeReplOutput(text: string): void {
  if (activeOutputWriter) {
    activeOutputWriter(text)
    return
  }

  process.stdout.write(text)
}

function printLines(lines: string[]): void {
  writeReplOutput(lines.join('\n') + '\n')
}

async function ensureBoardPlanFile(board: TaskBoard): Promise<TaskBoard> {
  const { filePath } = await ensurePlanFileForTaskBoard(board)
  if (board.planFilePath === filePath) {
    return board
  }

  return (
    (await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        planFilePath: filePath,
        updatedAt: new Date().toISOString(),
      }),
    )) ?? {
      ...board,
      planFilePath: filePath,
    }
  )
}

async function syncPlanModeRuntime(
  context: ReplCommandContext,
): Promise<TaskBoard | null> {
  const loadedBoard = await loadTaskBoardForSession(context.session.sessionId)
  const board = loadedBoard
    ? await recoverTaskBoardPlanFile(
        loadedBoard,
        context.engine.getMessages(),
      )
    : null
  const activePlanFilePath = board?.mode === 'active' ? board.planFilePath : undefined

  context.engine.setPlanFilePath(activePlanFilePath)
  if (board?.mode === 'active') {
    context.engine.setPermissionMode('plan')
    context.session.permissionMode = 'plan'
    context.session.permissionModeSource = 'task_board'
  } else if (context.session.permissionMode === 'plan') {
    const nextPermissionMode = board?.resumePermissionMode ?? 'default'
    context.engine.setPermissionMode(nextPermissionMode)
    context.session.permissionMode = nextPermissionMode
    context.session.permissionModeSource = 'task_board'
  }

  return board
}

async function printSessionInfo(context: ReplCommandContext): Promise<void> {
  const meta = await loadSessionMeta(context.session.sessionId)
  const taskBoard = meta?.taskBoardId
    ? await loadTaskBoard(meta.taskBoardId)
    : null
  const configured = await buildConfigAwareEnvWithSources(context.options.cwd)
  const llmConfig = await loadResolvedLlmConfig(context.options.cwd, configured.env)
  const runtime = resolveLlmRuntimeConfig(
    {
      runtime: context.options.runtime,
      model: context.session.model,
    },
    llmConfig,
    configured.env,
  )
  const compactRecommendation = context.engine.getCompactRecommendation()
  const messages = context.engine.getMessages()
  const compactBoundaries = getCompactBoundaryMessages(messages)
  const lastCompactBoundary = getLastCompactBoundary(messages)

  const lines = [
    'status:',
    `session id: ${context.session.sessionId}`,
    `mode: ${context.session.mode}`,
    `cwd: ${context.options.cwd}`,
    `runtime: ${context.session.runtimeName ?? runtime.runtimeName ?? 'stub'}`,
    `runtime source: ${runtime.runtimeSource}`,
    `provider: ${context.session.provider}`,
    `provider source: ${context.session.providerSource}`,
    `model: ${context.session.model ?? 'default'}`,
    `model source: ${context.session.modelSource}`,
    ...(runtime.model && runtime.canonicalModel && runtime.canonicalModel !== runtime.model
      ? [`model canonicalized to: ${runtime.canonicalModel}`]
      : []),
    ...(runtime.model
      ? [`catalog match: ${runtime.catalogMatch ?? 'none'}`]
      : []),
    `permission mode: ${context.session.permissionMode}`,
    `permission mode source: ${context.session.permissionModeSource}`,
    `stream: ${context.options.stream ? 'enabled' : 'disabled'}`,
    ...(context.engine.getQueryTracePath()
      ? [`query trace: ${context.engine.getQueryTracePath()}`]
      : []),
    ...(meta?.taskBoardId ? [`task board: ${meta.taskBoardId}`] : []),
    ...(taskBoard ? [`plan mode state: ${taskBoard.mode}`] : []),
    ...(taskBoard?.planFilePath ? [`plan file: ${taskBoard.planFilePath}`] : []),
    ...(taskBoard?.currentStep ? [`current step: ${taskBoard.currentStep}`] : []),
    ...formatCompactRecommendationLines(compactRecommendation),
    ...(compactBoundaries.length > 0
      ? [`compact boundaries: ${compactBoundaries.length}`]
      : []),
    ...(lastCompactBoundary
      ? [`last compact boundary: ${formatCompactBoundaryLabel(lastCompactBoundary)}`]
      : []),
  ]

  if (
    (runtime.providerConfig.provider === 'anthropic' ||
      runtime.providerConfig.provider === 'openai') &&
    runtime.model
  ) {
    appendModelLimitLines(lines, runtime.providerConfig.provider, runtime.model)
  }
  appendVisionRuntimeLines(lines, runtime.imageFallback)
  lines.push('')

  printLines(lines)
}

async function printTranscript(
  context: ReplCommandContext,
  maxMessages?: number,
): Promise<void> {
  const transcriptLines = formatTranscript(context.engine.getMessages(), {
    includeThinking: false,
    maxMessages,
  })
  const lastCompactBoundary = getLastCompactBoundary(context.engine.getMessages())
  const compactLines = lastCompactBoundary
    ? [`last compact boundary: ${formatCompactBoundaryLabel(lastCompactBoundary)}`, '']
    : []

  printLines([
    typeof maxMessages === 'number'
      ? `current transcript (latest ${maxMessages} messages):`
      : 'current transcript:',
    ...compactLines,
    ...(transcriptLines.length > 0 ? transcriptLines : ['<empty>']),
    '',
  ])
}

async function clearConversation(context: ReplCommandContext): Promise<void> {
  const board = await loadTaskBoardForSession(context.session.sessionId)
  const nextPermissionMode =
    context.session.permissionMode === 'plan'
      ? board?.resumePermissionMode ?? 'default'
      : (context.session.permissionMode as PermissionMode)
  const nextSession = await createSession({
    cwd: context.options.cwd,
    mode: 'interactive',
    runtimeName: context.session.runtimeName,
    provider: context.session.provider,
    model: context.session.model,
  })

  context.engine.resetMessages()
  context.engine.setSessionId(nextSession.sessionId)
  context.engine.setPermissionMode(nextPermissionMode)
  context.engine.setPlanFilePath(undefined)
  context.session.sessionId = nextSession.sessionId
  context.session.mode = 'interactive'
  context.session.permissionMode = nextPermissionMode
  const queryTracePath = await context.rotateQueryTrace?.(nextSession.sessionId)
  if (nextPermissionMode === 'plan') {
    context.session.permissionModeSource = 'task_board'
  }

  printLines([
    'Started a new empty session.',
    `session id: ${nextSession.sessionId}`,
    ...(queryTracePath ? [`query trace: ${queryTracePath}`] : []),
    '',
  ])
}

function formatTaskBoardSummary(board: TaskBoard): string[] {
  const currentTask = getCurrentTask(board)

  return [
    `task board: ${board.boardId}`,
    ...getTaskBoardBriefObservationLines(board),
    `plan mode: ${board.mode}`,
    `workspace: ${board.workspaceId}`,
    `root session: ${board.rootSessionId}`,
    `latest session: ${board.latestSessionId}`,
    `plan file: ${board.planFilePath ?? '<none>'}`,
    `current task: ${currentTask?.subject ?? '<none>'}`,
    `current step: ${board.currentStep ?? '<none>'}`,
  ]
}

async function getOrCreateCurrentTaskBoard(
  context: ReplCommandContext,
): Promise<TaskBoard> {
  const existing = await loadTaskBoardForSession(context.session.sessionId)
  if (existing) {
    const updated =
      existing.latestSessionId !== context.session.sessionId
        ? await updateTaskBoardLatestSession(
            existing.boardId,
            context.session.sessionId,
          )
        : existing
    return updated ?? existing
  }

  const board = await createTaskBoard({
    workspaceId: context.options.cwd,
    rootSessionId: context.session.sessionId,
  })
  await attachTaskBoardToSession(context.session.sessionId, board.boardId)
  return board
}

async function showPlanState(context: ReplCommandContext): Promise<void> {
  const board = await syncPlanModeRuntime(context)
  if (!board) {
    printLines([
      'No task board is attached to this session yet.',
      'Use /plan to enter plan mode and create one.',
      '',
    ])
    return
  }

  const planContent =
    board.planFilePath
      ? await readPlanFile(board.planFilePath)
      : null
  const planPreview = planContent
    ?.split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('#'))

  printLines([
    ...formatTaskBoardSummary(board),
    ...(board.planFilePath && existsSync(board.planFilePath)
      ? ['plan file status: ready']
      : ['plan file status: missing']),
    ...(planPreview ? [`plan preview: ${planPreview}`] : []),
    '',
  ])
}

async function enterPlanMode(context: ReplCommandContext): Promise<void> {
  const board = await ensureBoardPlanFile(await getOrCreateCurrentTaskBoard(context))
  const updated =
    board.mode === 'active' && context.session.permissionMode === 'plan'
      ? board
      : await updateTaskBoard(
          board.boardId,
          current => ({
            ...current,
            planFilePath: board.planFilePath,
            mode: 'active',
            latestSessionId: context.session.sessionId,
            needsPlanModeExitReminder: false,
            resumePermissionMode:
              context.session.permissionMode === 'plan'
                ? current.resumePermissionMode ?? 'default'
                : (context.session.permissionMode as PermissionMode),
            updatedAt: new Date().toISOString(),
          }),
        )

  context.engine.setPermissionMode('plan')
  context.engine.setPlanFilePath(updated?.planFilePath ?? board.planFilePath)
  context.session.permissionMode = 'plan'
  context.session.permissionModeSource = 'repl_command'
  await appendPlanSnapshotForFile(
    context.session.sessionId,
    updated?.planFilePath ?? board.planFilePath,
    'repl-enter-plan-mode',
  )

  printLines([
    'Entered plan mode for this REPL session.',
    ...(updated ? formatTaskBoardSummary(updated) : []),
    '',
  ])
}

async function exitPlanMode(context: ReplCommandContext): Promise<void> {
  const board = await loadTaskBoardForSession(context.session.sessionId)
  if (!board) {
    printLines([
      'No task board is attached to this session yet.',
      '',
    ])
    return
  }

  const nextPermissionMode = board.resumePermissionMode ?? 'default'
  const updated = await updateTaskBoard(
    board.boardId,
    current => ({
      ...current,
      mode: 'inactive',
      hasExitedPlanModeInSession: true,
      needsPlanModeExitReminder: true,
      planModeReminderCount: undefined,
      lastPlanModeReminderTurnCount: undefined,
      resumePermissionMode: undefined,
      latestSessionId: context.session.sessionId,
      updatedAt: new Date().toISOString(),
    }),
  )

  context.engine.setPermissionMode(nextPermissionMode)
  context.engine.setPlanFilePath(undefined)
  context.session.permissionMode = nextPermissionMode
  context.session.permissionModeSource = 'repl_command'
  await appendPlanSnapshotForFile(
    context.session.sessionId,
    updated?.planFilePath ?? board.planFilePath,
    'repl-exit-plan-mode',
  )

  printLines([
    `Exited plan mode. Restored permission mode: ${nextPermissionMode}`,
    ...(updated ? formatTaskBoardSummary(updated) : []),
    '',
  ])
}

async function handlePlanCommand(
  args: string[],
  context: ReplCommandContext,
): Promise<void> {
  const subcommand = args[0]?.toLowerCase()

  if (subcommand === 'exit') {
    await exitPlanMode(context)
    return
  }

  if (subcommand === 'start') {
    const title = args.slice(1).join(' ').trim()
    const board = await getOrCreateCurrentTaskBoard(context)
    if (!title) {
      printLines([
        ...(board ? formatTaskBoardSummary(board) : []),
        '',
      ])
      return
    }

    const now = new Date().toISOString()
    const task = createTaskRecord(title, now)
    const updated = await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        currentTaskId: task.id,
        tasks: [
          ...current.tasks.map(existing =>
            existing.status === 'in_progress'
              ? setTaskStatus(existing, 'pending', now)
              : existing,
          ),
          setTaskStatus(task, 'in_progress', now),
        ],
        updatedAt: now,
      }),
    )

    printLines([
      `Started task: ${title}`,
      ...(updated ? formatTaskBoardSummary(updated) : []),
      '',
    ])
    return
  }

  const board = await loadTaskBoardForSession(context.session.sessionId)
  if (board?.mode === 'active' || context.session.permissionMode === 'plan') {
    await showPlanState(context)
    return
  }

  await enterPlanMode(context)
}

async function compactConversation(
  args: string[],
  context: ReplCommandContext,
): Promise<void> {
  const allMessages = context.engine.getMessages()
  const messages = getMessagesAfterCompactBoundary(
    getCurrentModelVisibleMessages(context.engine),
  )
  if (messages.length === 0) {
    printLines([
      'Nothing to compact. The current conversation is already empty.',
      '',
    ])
    return
  }

  const instructionText = args.join(' ').trim()
  const contextStats = context.engine.getContextStats()
  const configured = await buildConfigAwareEnvWithSources(context.options.cwd)
  const { boundary, boundaryMessage, summaryMessage } = await compactSession({
    sourceSessionId: context.session.sessionId,
    messages,
    cwd: context.options.cwd,
    provider: context.session.provider,
    model: context.session.model,
    trigger: 'manual',
    reason: instructionText
      ? `user requested /compact: ${instructionText}`
      : 'user requested /compact',
    instructionText,
    contextStats,
    client: context.engine.getClient(),
    env: configured.env,
  })

  context.engine.preparePostCompactRecovery(boundary.boundaryId)
  context.engine.resetMessages([
    ...allMessages,
    boundaryMessage,
    summaryMessage,
  ])

  printLines([
    'Compacted conversation into a summary within the current session.',
    `session id: ${context.session.sessionId}`,
    `compact boundary: ${formatCompactBoundaryLabel(boundary)}`,
    `context snapshot: ${contextStats.approxChars} chars / ${contextStats.approxTokens} tokens / ${contextStats.persistedToolResultCount} persisted tool results`,
    '',
  ])
}

function formatRuntimeSummaryLines(
  runtime: ResolvedLlmRuntimeConfig,
  queryTracePath?: string,
): string[] {
  return [
    `runtime: ${runtime.runtimeName ?? 'stub'}`,
    `runtime source: ${runtime.runtimeSource}`,
    `provider: ${runtime.provider}`,
    `provider ref: ${runtime.primary.providerRef}`,
    `model: ${runtime.model ?? 'default'}`,
    `model source: ${runtime.modelSource}`,
    ...(runtime.model && runtime.canonicalModel && runtime.canonicalModel !== runtime.model
      ? [`model canonicalized to: ${runtime.canonicalModel}`]
      : []),
    ...(runtime.model
      ? [`catalog match: ${runtime.catalogMatch ?? 'none'}`]
      : []),
    `image input: ${runtime.primary.modelCapabilities.supportsImageInput ? 'supported' : 'not supported'}`,
    `image fallback: ${runtime.imageFallback ? `${runtime.imageFallback.provider} / ${runtime.imageFallback.model ?? 'default'}` : 'not configured'}`,
    ...(queryTracePath ? [`query trace: ${queryTracePath}`] : []),
  ]
}

function formatAvailableRuntimeLines(
  llmConfig: Awaited<ReturnType<typeof loadResolvedLlmConfig>>,
  activeRuntimeName?: string,
): string[] {
  const runtimeNames = Object.keys(llmConfig.runtimes).sort((left, right) =>
    left.localeCompare(right),
  )
  if (runtimeNames.length === 0) {
    return ['available runtimes: none']
  }

  return [
    'available runtimes:',
    ...runtimeNames.map(name => {
      const profile = llmConfig.runtimes[name]
      const model = profile.primary.model ?? 'default'
      const fallback = profile.imageFallback?.model
      const marker = name === activeRuntimeName ? '* ' : '- '
      return `${marker}${name}  ${profile.primary.providerRef} / ${model}${fallback ? `  imageFallback=${fallback}` : ''}`
    }),
  ]
}

async function printCurrentRuntime(
  context: ReplCommandContext,
  mode: 'current' | 'list' = 'current',
): Promise<void> {
  const configured = await buildConfigAwareEnvWithSources(context.options.cwd)
  const llmConfig = await loadResolvedLlmConfig(context.options.cwd, configured.env)
  const runtime = resolveLlmRuntimeConfig(
    {
      runtime: context.options.runtime,
    },
    llmConfig,
    configured.env,
  )

  if (mode === 'list') {
    printLines([
      ...formatAvailableRuntimeLines(llmConfig, runtime.runtimeName),
      '',
    ])
    return
  }

  printLines([
    'current runtime:',
    ...formatRuntimeSummaryLines(runtime),
    '',
    ...formatAvailableRuntimeLines(llmConfig, runtime.runtimeName),
    '',
  ])
}

async function setCurrentRuntime(
  args: string[],
  context: ReplCommandContext,
): Promise<void> {
  if (args.length === 0) {
    await printCurrentRuntime(context)
    return
  }

  const nextRuntime = args.join(' ').trim()
  if (!nextRuntime) {
    await printCurrentRuntime(context)
    return
  }

  if (nextRuntime === 'list') {
    await printCurrentRuntime(context, 'list')
    return
  }

  if (!context.switchRuntime) {
    printLines([
      'Runtime switching is not available in this REPL context.',
      '',
    ])
    return
  }

  const { runtime, queryTracePath } = await context.switchRuntime(nextRuntime)
  context.session.runtimeName = runtime.runtimeName
  await updateSessionMeta(context.session.sessionId, meta => ({
    ...meta,
    runtimeName: runtime.runtimeName,
    provider: runtime.provider,
    model: runtime.model,
    updatedAt: new Date().toISOString(),
  }))

  printLines([
    `Runtime updated for this REPL session: ${runtime.runtimeName ?? nextRuntime}`,
    ...formatRuntimeSummaryLines(runtime, queryTracePath),
    '',
  ])
}

function printCurrentPermissionMode(context: ReplCommandContext): void {
  printLines([
    `Current permission mode: ${context.session.permissionMode}`,
    `Available modes: ${ALL_PERMISSION_MODES.join(', ')}`,
    'Use /permissions <mode> to switch permission modes for this REPL session.',
    '',
  ])
}

function formatSkillStatusLines(skills: SkillStatus[]): string[] {
  if (skills.length === 0) {
    return ['No skills are currently available.']
  }

  return skills
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
    .map(skill => {
      const status = skill.enabled ? 'enabled' : 'disabled'
      const context = skill.context ? ` ${skill.context}` : ''
      return `${status.padEnd(8)} ${skill.name} (${skill.source}${context})  ${skill.description}`
    })
}

async function handleSkillsCommand(
  args: string[],
  context: ReplCommandContext,
): Promise<void> {
  if (args.length > 0) {
    printLines([
      'Usage: /skills',
      '',
    ])
    return
  }

  if (!context.listSkillStatuses) {
    printLines([
      'Skills are not available in this REPL context.',
      '',
    ])
    return
  }

  printLines([
    'Skills:',
    ...formatSkillStatusLines(await context.listSkillStatuses()),
    '',
  ])
}

function setCurrentPermissionMode(
  args: string[],
  context: ReplCommandContext,
): void {
  if (args.length === 0) {
    printCurrentPermissionMode(context)
    return
  }

  const nextPermissionMode = args.join(' ').trim()
  if (!ALL_PERMISSION_MODES.includes(nextPermissionMode as PermissionMode)) {
    printLines([
      `Invalid permission mode: ${nextPermissionMode}`,
      `Available modes: ${ALL_PERMISSION_MODES.join(', ')}`,
      '',
    ])
    return
  }

  context.engine.setPermissionMode(nextPermissionMode as PermissionMode)
  context.session.permissionMode = nextPermissionMode
  context.session.permissionModeSource = 'repl_command'

  printLines([
    `Permission mode updated for this REPL session: ${nextPermissionMode}`,
    '',
  ])
}

async function printResumeSuggestions(): Promise<void> {
  const sessions = await listSessionHistory()
  const lines = ['Usage: /resume <session-id>', '']

  if (sessions.length === 0) {
    lines.push('No saved sessions found yet.', '')
    printLines(lines)
    return
  }

  lines.push('Recent sessions:', '')
  sessions.slice(0, 5).forEach((session, index) => {
    lines.push(
      `${index + 1}. ${session.meta.sessionId}  ${session.meta.mode}  ${session.meta.updatedAt}`,
    )
    lines.push(`   cwd: ${session.meta.cwd}`)
    lines.push(`   runtime: ${formatRuntimeLabel(session.meta.runtimeName)}`)
    lines.push(
      `   provider/model: ${formatProviderModelLabel(session.meta.provider, session.meta.model)}`,
    )
    if (session.lastUserText) {
      lines.push(`   last user: ${session.lastUserText}`)
    }
    if (session.lastAssistantText) {
      lines.push(`   last assistant: ${session.lastAssistantText}`)
    }
    if (index < Math.min(sessions.length, 5) - 1) {
      lines.push('')
    }
  })
  lines.push('', 'Use /resume <session-id> to switch this REPL to one of them.', '')
  printLines(lines)
}

async function resumeConversation(
  args: string[],
  context: ReplCommandContext,
): Promise<void> {
  const sessionId = args[0]?.trim()
  if (!sessionId) {
    await printResumeSuggestions()
    return
  }

  const resumed = await loadSessionForResume(sessionId)
  if (!resumed) {
    printLines([
      `Session not found: ${sessionId}`,
      '',
    ])
    return
  }

  if (!resumed.meta.runtimeName) {
    printLines([
      `Session ${sessionId} is missing runtime metadata and cannot be resumed in this build.`,
      '',
    ])
    return
  }

  context.engine.resetMessages(resumed.messages)
  context.session.sessionId = resumed.meta.sessionId
  context.session.mode = 'resume'
  context.engine.setSessionId(resumed.meta.sessionId)
  context.options.runtime = resumed.meta.runtimeName

  let queryTracePath: string | undefined
  if (context.switchRuntime) {
    const switched = await context.switchRuntime(resumed.meta.runtimeName)
    queryTracePath = switched.queryTracePath
  } else {
    context.session.runtimeName = resumed.meta.runtimeName
    context.session.provider = resumed.meta.provider
    context.session.model = resumed.meta.model
    queryTracePath = await context.rotateQueryTrace?.(resumed.meta.sessionId)
  }

  context.engine.resetMessages(resumed.messages)
  context.engine.setSessionId(resumed.meta.sessionId)
  const taskBoard = await syncPlanModeRuntime(context)
  await updateSessionMeta(context.session.sessionId, meta => ({
    ...meta,
    runtimeName: context.session.runtimeName,
    provider: context.session.provider,
    model: context.session.model,
    updatedAt: new Date().toISOString(),
  }))
  const transcriptLines = formatTranscript(resumed.messages, {
    includeThinking: false,
    maxMessages: 10,
  })
  const compactBoundaries = getCompactBoundaryMessages(resumed.messages)
  const lastCompactBoundary = getLastCompactBoundary(resumed.messages)

  printLines([
    `Resumed session: ${resumed.meta.sessionId}`,
    `restored runtime: ${formatRuntimeLabel(context.session.runtimeName)}`,
    `restored provider/model: ${formatProviderModelLabel(
      context.session.provider,
      context.session.model,
    )}`,
    ...(compactBoundaries.length > 0
      ? [`compact boundaries: ${compactBoundaries.length}`]
      : []),
    ...(lastCompactBoundary
      ? [`last compact boundary: ${formatCompactBoundaryLabel(lastCompactBoundary)}`]
      : []),
    ...(taskBoard ? getTaskBoardObservationLines(taskBoard) : []),
    ...(resumed.subagents.count > 0
      ? [
          `subagents: ${resumed.subagents.count}`,
          ...(resumed.subagents.lastStatus && resumed.subagents.lastTask
            ? [
                `last subagent: ${resumed.subagents.lastStatus}  ${resumed.subagents.lastTask}`,
              ]
            : []),
          ...(resumed.subagents.lastTracePath
            ? [`last subagent trace: ${resumed.subagents.lastTracePath}`]
            : []),
        ]
      : []),
    ...(queryTracePath ? [`query trace: ${queryTracePath}`] : []),
    '',
    'restored transcript preview:',
    ...(transcriptLines.length > 0 ? transcriptLines : ['<empty>']),
    '',
  ])
}

const REPL_COMMANDS: ReplCommandDefinition[] = [
  {
    name: '/status',
    displayName: 'Status',
    description: 'Show current DCLAW status.',
    argKind: 'none',
    canRunWhileBusy: true,
    presentationKind: 'structured_card',
    presentationTitle: 'Status',
    async handle(_args, context) {
      await printSessionInfo(context)
    },
  },
  {
    name: '/runtime',
    displayName: 'Runtime',
    argumentHint: '[name|list]',
    argKind: 'enum',
    description: 'Show the current runtime, list available runtimes, or switch to one.',
    presentationKind: 'structured_card',
    presentationTitle: 'Runtime',
    async handle(args, context) {
      await setCurrentRuntime(args, context)
    },
  },
  {
    name: '/permissions',
    displayName: 'Permissions',
    argumentHint: '[mode]',
    argKind: 'enum',
    description:
      'Show or change the active permission mode for this REPL session.',
    presentationKind: 'structured_card',
    presentationTitle: 'Permissions',
    handle(args, context) {
      setCurrentPermissionMode(args, context)
    },
  },
  {
    name: '/skills',
    displayName: 'Skills',
    argKind: 'none',
    description: 'Open the skills menu.',
    canRunWhileBusy: true,
    presentationKind: 'structured_card',
    presentationTitle: 'Skills',
    async handle(args, context) {
      await handleSkillsCommand(args, context)
    },
  },
  {
    name: '/resume',
    aliases: ['/continue'],
    displayName: 'Resume',
    argumentHint: '[session-id]',
    argKind: 'freeform',
    description:
      'Resume a saved session inside the current REPL, or list recent sessions when no id is provided.',
    presentationKind: 'assistant_note',
    async handle(args, context) {
      await resumeConversation(args, context)
    },
  },
  {
    name: '/compact',
    displayName: 'Compact',
    argumentHint: '[instructions]',
    argKind: 'freeform',
    description:
      'Compact the current conversation into a local summary and continue in a fresh session.',
    presentationKind: 'structured_card',
    presentationTitle: 'Compact Session',
    async handle(args, context) {
      await compactConversation(args, context)
    },
  },
  {
    name: '/clear',
    displayName: 'Clear Session',
    description: 'Clear conversation history and start a new empty session.',
    argKind: 'none',
    presentationKind: 'structured_card',
    presentationTitle: 'Session Reset',
    async handle(_args, context) {
      await clearConversation(context)
    },
  },
  {
    name: '/exit',
    aliases: ['/quit'],
    displayName: 'Exit',
    description: 'Exit the REPL.',
    argKind: 'none',
    handle() {
      // The REPL loop intercepts /exit before command dispatch.
    },
  },
]

function findReplCommand(name: string): ReplCommandDefinition | undefined {
  const normalized = name.toLowerCase()
  return REPL_COMMANDS.find(
    command =>
      command.name.toLowerCase() === normalized ||
      command.aliases?.some(alias => alias.toLowerCase() === normalized),
  )
}

export function listReplCommands(): ReplCommandCatalogItem[] {
  return REPL_COMMANDS.map(command => ({
    name: command.name,
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    displayName: command.displayName ?? command.name.replace(/^\//u, ''),
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    argKind: command.argKind ?? (command.argumentHint ? 'freeform' : 'none'),
    ...(command.canRunWhileBusy ? { canRunWhileBusy: true } : {}),
    presentationKind: command.presentationKind ?? 'assistant_note',
    ...(command.presentationTitle
      ? { presentationTitle: command.presentationTitle }
      : {}),
  }))
}

export async function maybeHandleReplCommand(
  prompt: string,
  context: ReplCommandContext,
  options: {
    allowDuringActivePrompt?: boolean
    writeOutput?: (text: string) => void
  } = {},
): Promise<boolean> {
  const previousWriter = activeOutputWriter
  activeOutputWriter = options.writeOutput ?? previousWriter
  try {
    const trimmedPrompt = prompt.trim()
    const [commandName, ...args] = trimmedPrompt.split(/\s+/)
    const command = findReplCommand(commandName)

    if (!command) {
      if (commandName.startsWith('/')) {
        printLines([
          `Unknown REPL command: ${commandName}`,
          'Type / to browse available commands.',
          '',
        ])
        return true
      }
      return false
    }

    if (options.allowDuringActivePrompt && !command.canRunWhileBusy) {
      printLines([
        `${command.name} cannot run while a response is active. Press Esc to stop the response, or wait for it to finish.`,
        '',
      ])
      return true
    }

    await command.handle(args, context)
    return true
  } finally {
    activeOutputWriter = previousWriter
  }
}
