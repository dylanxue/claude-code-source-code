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
import type { LlmProviderName } from '../llm/providerNames.js'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import { listSessionHistory } from '../session/history.js'
import { loadSessionForResume } from '../session/resume.js'
import { createSession, loadSessionMeta } from '../session/store.js'
import {
  ensurePlanFileForTaskBoard,
  readPlanFile,
} from '../tasks/planFiles.js'
import {
  appendPlanSnapshotForFile,
  recoverTaskBoardPlanFile,
} from '../tasks/planSnapshots.js'
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
import {
  getModelVisibleMessages,
  type Message,
} from '../types/message.js'
import {
  buildConfigAwareEnvWithSources,
  loadDclawConfigFiles,
} from './configFile.js'
import {
  appendModelLimitLines,
  appendReliabilityConfigLines,
  getLimitsConfigStatus,
  statusLine,
} from './diagnostics.js'
import { resolveMaxIterations } from './maxIterationsConfig.js'
import { runHistory } from './history.js'
import { ALL_PERMISSION_MODES } from './permissionModeConfig.js'
import type { CommonCliOptions } from './types.js'

function getCurrentModelVisibleMessages(engine: QueryEngine): Message[] {
  return getModelVisibleMessages(engine.getMessages())
}

export type ReplSessionState = {
  sessionId: string
  mode: 'interactive' | 'resume'
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
}

type ReplCommandDefinition = {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  handle: (
    args: string[],
    context: ReplCommandContext,
  ) => Promise<void> | void
}

function printLines(lines: string[]): void {
  process.stdout.write(lines.join('\n') + '\n')
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined
  }

  return parsed
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
  const compactRecommendation = context.engine.getCompactRecommendation()
  const messages = context.engine.getMessages()
  const compactBoundaries = getCompactBoundaryMessages(messages)
  const lastCompactBoundary = getLastCompactBoundary(messages)

  printLines([
    'current session:',
    `session id: ${context.session.sessionId}`,
    `mode: ${context.session.mode}`,
    `cwd: ${context.options.cwd}`,
    `provider: ${context.session.provider}`,
    `provider source: ${context.session.providerSource}`,
    `model: ${context.session.model ?? 'default'}`,
    `model source: ${context.session.modelSource}`,
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
    '',
  ])
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

function clearTerminal(): void {
  process.stdout.write('\x1b[2J\x1b[H')
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

async function printDoctor(context: ReplCommandContext): Promise<void> {
  const cwd = context.options.cwd
  const configured = await buildConfigAwareEnvWithSources(cwd)
  const resolvedMaxIterations = await resolveMaxIterations(
    {
      cwd,
      maxIterations: context.options.maxIterations,
    },
    configured.env,
    key => configured.keySources[key],
  )
  const runtime = resolveLlmRuntimeConfig(
    {
      provider: context.session.provider as LlmProviderName,
      model: context.session.model,
    },
    configured.env,
    key => configured.keySources[key],
  )
  const compactRecommendation = context.engine.getCompactRecommendation()
  const compactPressureValue =
    compactRecommendation.percentLeft === undefined
      ? `${compactRecommendation.level} (thresholds unavailable)`
      : `${compactRecommendation.level} (${compactRecommendation.percentLeft}% until auto-compact)`
  const lines = [
    'dclaw doctor',
    '',
    statusLine('node', process.version),
    statusLine('platform', process.platform),
    statusLine('cwd', cwd),
    statusLine('cwd exists', existsSync(cwd) ? 'yes' : 'no'),
    statusLine('mode', 'repl'),
    statusLine('session id', context.session.sessionId),
    statusLine('session mode', context.session.mode),
    statusLine('permission mode', context.session.permissionMode),
    statusLine('permission source', context.session.permissionModeSource),
    statusLine(
      'max iterations',
      `${resolvedMaxIterations.maxIterations} (${resolvedMaxIterations.maxIterationsSource})`,
    ),
    statusLine('compact pressure', compactPressureValue),
    statusLine(
      'compact recommendation',
      compactRecommendation.shouldCompact ? 'compact soon (dry-run)' : 'none',
    ),
    statusLine(
      'compact tokens',
      compactRecommendation.autoCompactThresholdTokens === undefined
        ? `${compactRecommendation.tokenUsage} (thresholds unavailable)`
        : `${compactRecommendation.tokenUsage}/${compactRecommendation.autoCompactThresholdTokens}`,
    ),
    statusLine(
      'compact remaining',
      compactRecommendation.percentLeft === undefined
        ? 'unknown'
        : `${compactRecommendation.percentLeft}% until auto-compact`,
    ),
    statusLine(
      'compact used',
      compactRecommendation.percentUsed === undefined
        ? 'unknown'
        : `${compactRecommendation.percentUsed}% of effective window`,
    ),
    statusLine(
      'compact thresholds',
      compactRecommendation.autoCompactThresholdTokens === undefined ||
        compactRecommendation.warningThresholdTokens === undefined ||
        compactRecommendation.blockingLimitTokens === undefined
        ? 'unavailable'
        : `warn ${compactRecommendation.warningThresholdTokens} / auto ${compactRecommendation.autoCompactThresholdTokens} / block ${compactRecommendation.blockingLimitTokens}`,
    ),
    statusLine('provider', runtime.provider),
    statusLine('provider source', context.session.providerSource),
  ]
  if (compactRecommendation.reasons.length > 0) {
    lines.push(
      statusLine('compact reasons', compactRecommendation.reasons.join('; ')),
    )
  }

  if (runtime.providerConfig.provider === 'anthropic') {
    const config = runtime.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', context.session.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.model) {
      appendModelLimitLines(lines, 'anthropic', runtime.model)
    }
  } else if (runtime.providerConfig.provider === 'openai') {
    const config = runtime.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('api style', config.apiStyle))
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', context.session.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.model) {
      appendModelLimitLines(lines, 'openai', runtime.model)
    }
  } else {
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', context.session.modelSource))
  }

  appendReliabilityConfigLines(lines, configured.env, key => configured.keySources[key])
  printLines(lines)
}

function printCurrentModel(context: ReplCommandContext): void {
  printLines([
    `Current model: ${context.session.model ?? 'default'}`,
    'Use /model <name> to switch models for this REPL session.',
    '',
  ])
}

function setCurrentModel(args: string[], context: ReplCommandContext): void {
  if (args.length === 0) {
    printCurrentModel(context)
    return
  }

  const nextModel = args.join(' ').trim()
  if (!nextModel) {
    printCurrentModel(context)
    return
  }

  context.engine.setModel(nextModel)
  context.session.model = nextModel
  context.session.modelSource = 'repl_command'

  printLines([
    `Model updated for this REPL session: ${nextModel}`,
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

async function printConfig(context: ReplCommandContext): Promise<void> {
  const cwd = context.options.cwd
  const [configFiles, configured] = await Promise.all([
    loadDclawConfigFiles(cwd),
    buildConfigAwareEnvWithSources(cwd),
  ])
  const configKeyLines = Object.entries(configured.keySources)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, source]) => `${key} (${source})`)

  printLines([
    'dclaw config',
    '',
    `user config path: ${configFiles.userConfigPath}`,
    `user config: ${configFiles.userConfig ? 'loaded' : 'not found'}`,
    `workspace config path: ${configFiles.workspaceConfigPath}`,
    `workspace config: ${configFiles.workspaceConfig ? 'loaded' : 'not found'}`,
    `active permission mode: ${context.session.permissionMode} (${context.session.permissionModeSource})`,
    ...(configKeyLines.length > 0
      ? ['', 'config-backed env keys:', ...configKeyLines.map(line => `- ${line}`)]
      : ['', 'config-backed env keys: none']),
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
    lines.push(
      `   provider: ${session.meta.provider}${session.meta.model ? ` / ${session.meta.model}` : ''}`,
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

  context.engine.resetMessages(resumed.messages)
  context.engine.setSessionId(resumed.meta.sessionId)
  context.session.sessionId = resumed.meta.sessionId
  context.session.mode = 'resume'
  const queryTracePath = await context.rotateQueryTrace?.(resumed.meta.sessionId)
  const taskBoard = await syncPlanModeRuntime(context)

  if (resumed.meta.provider === context.session.provider && resumed.meta.model) {
    context.engine.setModel(resumed.meta.model)
    context.session.model = resumed.meta.model
    context.session.modelSource = 'resumed_session'
  }
  const currentTask = taskBoard ? getCurrentTask(taskBoard) : undefined

  const transcriptLines = formatTranscript(resumed.messages, {
    includeThinking: false,
    maxMessages: 10,
  })
  const compactBoundaries = getCompactBoundaryMessages(resumed.messages)
  const lastCompactBoundary = getLastCompactBoundary(resumed.messages)

  printLines([
    `Resumed session: ${resumed.meta.sessionId}`,
    `stored provider/model: ${resumed.meta.provider}${resumed.meta.model ? ` / ${resumed.meta.model}` : ''}`,
    ...(resumed.meta.provider !== context.session.provider
      ? [
          `continuing with current provider: ${context.session.provider}`,
        ]
      : []),
    ...(compactBoundaries.length > 0
      ? [`compact boundaries: ${compactBoundaries.length}`]
      : []),
    ...(lastCompactBoundary
      ? [`last compact boundary: ${formatCompactBoundaryLabel(lastCompactBoundary)}`]
      : []),
    ...(taskBoard ? [`plan mode state: ${taskBoard.mode}`] : []),
    ...(taskBoard?.planFilePath ? [`plan file: ${taskBoard.planFilePath}`] : []),
    ...(currentTask ? [`current task: ${currentTask.subject}`] : []),
    ...(taskBoard?.currentStep ? [`current step: ${taskBoard.currentStep}`] : []),
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
    name: '/help',
    description: 'Show available REPL commands.',
    handle() {
      printLines([
        'REPL commands:',
        ...REPL_COMMANDS.map(command => {
          const aliases =
            command.aliases && command.aliases.length > 0
              ? ` (${command.aliases.join(', ')})`
              : ''
          const argumentHint = command.argumentHint
            ? ` ${command.argumentHint}`
            : ''
          return `${command.name}${argumentHint}${aliases}  ${command.description}`
        }),
        '',
      ])
    },
  },
  {
    name: '/plan',
    argumentHint: '[start <title>|exit]',
    description: 'Enter plan mode, show the current plan state, or exit plan mode.',
    async handle(args, context) {
      await handlePlanCommand(args, context)
    },
  },
  {
    name: '/session',
    aliases: ['/info'],
    description: 'Show current session info.',
    async handle(_args, context) {
      await printSessionInfo(context)
    },
  },
  {
    name: '/history',
    description: 'Show recent saved sessions.',
    async handle(_args, context) {
      await runHistory({
        mode: 'history',
        options: context.options,
      })
    },
  },
  {
    name: '/doctor',
    description: 'Show diagnostics for the current REPL session.',
    async handle(_args, context) {
      await printDoctor(context)
    },
  },
  {
    name: '/model',
    argumentHint: '[model]',
    description: 'Show or change the active model for this REPL session.',
    handle(args, context) {
      setCurrentModel(args, context)
    },
  },
  {
    name: '/permissions',
    argumentHint: '[mode]',
    description:
      'Show or change the active permission mode for this REPL session.',
    handle(args, context) {
      setCurrentPermissionMode(args, context)
    },
  },
  {
    name: '/config',
    description: 'Show loaded dclaw config files and config-backed env keys.',
    async handle(_args, context) {
      await printConfig(context)
    },
  },
  {
    name: '/transcript',
    argumentHint: '[N]',
    description:
      'Show the current conversation transcript, optionally limited to the latest N messages.',
    async handle(args, context) {
      if (args.length === 0) {
        await printTranscript(context)
        return
      }

      const maxMessages = parsePositiveInteger(args[0])
      if (maxMessages === undefined) {
        printLines([
          'Invalid transcript limit. Use /transcript or /transcript <positive integer>.',
          '',
        ])
        return
      }

      await printTranscript(context, maxMessages)
    },
  },
  {
    name: '/resume',
    aliases: ['/continue'],
    argumentHint: '[session-id]',
    description:
      'Resume a saved session inside the current REPL, or list recent sessions when no id is provided.',
    async handle(args, context) {
      await resumeConversation(args, context)
    },
  },
  {
    name: '/compact',
    argumentHint: '[instructions]',
    description:
      'Compact the current conversation into a local summary and continue in a fresh session.',
    async handle(args, context) {
      await compactConversation(args, context)
    },
  },
  {
    name: '/clear',
    description: 'Clear conversation history and start a new empty session.',
    async handle(_args, context) {
      await clearConversation(context)
    },
  },
  {
    name: '/cls',
    description: 'Clear the terminal screen.',
    handle() {
      clearTerminal()
    },
  },
  {
    name: '/exit',
    aliases: ['/quit'],
    description: 'Exit the REPL.',
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

export async function maybeHandleReplCommand(
  prompt: string,
  context: ReplCommandContext,
): Promise<boolean> {
  const trimmedPrompt = prompt.trim()
  const [commandName, ...args] = trimmedPrompt.split(/\s+/)
  const command = findReplCommand(commandName)

  if (!command) {
    return false
  }

  await command.handle(args, context)
  return true
}
