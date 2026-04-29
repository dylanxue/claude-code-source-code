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
  ensureSessionPlanFile,
  loadSessionMeta,
  updateSessionMeta,
  updateSessionPlanMode,
  type PlanModeState,
} from '../session/store.js'
import {
  readPlanFile,
} from '../tasks/planFiles.js'
import {
  appendPlanSnapshotForFile,
  recoverSessionPlanFile,
} from '../tasks/planSnapshots.js'
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

export type InteractiveSessionState = {
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

export type SlashCommandContext = {
  engine: QueryEngine
  options: CommonCliOptions
  session: InteractiveSessionState
  rotateQueryTrace?: (sessionId?: string) => Promise<string | undefined>
  env?: NodeJS.ProcessEnv
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

export type SlashCommandPresentationKind =
  | 'assistant_note'
  | 'structured_card'

export type SlashCommandArgKind =
  | 'none'
  | 'freeform'
  | 'enum'

type SlashCommandDefinition = {
  name: string
  aliases?: string[]
  displayName?: string
  description: string
  argumentHint?: string
  argKind?: SlashCommandArgKind
  canRunWhileBusy?: boolean
  presentationKind?: SlashCommandPresentationKind
  presentationTitle?: string
  handle: (
    args: string[],
    context: SlashCommandContext,
  ) => Promise<void> | void
}

export type SlashCommandCatalogItem = {
  name: string
  aliases?: string[]
  displayName: string
  description: string
  argumentHint?: string
  argKind: SlashCommandArgKind
  canRunWhileBusy?: boolean
  presentationKind: SlashCommandPresentationKind
  presentationTitle?: string
}

let activeOutputWriter: ((text: string) => void) | undefined

function writeSlashCommandOutput(text: string): void {
  if (activeOutputWriter) {
    activeOutputWriter(text)
    return
  }

  process.stdout.write(text)
}

function printLines(lines: string[]): void {
  writeSlashCommandOutput(lines.join('\n') + '\n')
}

async function syncPlanModeRuntime(
  context: SlashCommandContext,
): Promise<PlanModeState | undefined> {
  const recoveredPlanFilePath = await recoverSessionPlanFile(
    context.session.sessionId,
    context.engine.getMessages(),
  )
  const meta = await loadSessionMeta(context.session.sessionId)
  const planMode = meta?.planMode
  const activePlanFilePath =
    planMode?.status === 'active'
      ? planMode.planFilePath ?? recoveredPlanFilePath
      : undefined

  context.engine.setPlanFilePath(activePlanFilePath)
  if (planMode?.status === 'active') {
    context.engine.setPermissionMode('plan')
    context.session.permissionMode = 'plan'
    context.session.permissionModeSource = 'plan_mode'
  } else if (context.session.permissionMode === 'plan') {
    const nextPermissionMode = planMode?.resumePermissionMode ?? 'default'
    context.engine.setPermissionMode(nextPermissionMode)
    context.session.permissionMode = nextPermissionMode
    context.session.permissionModeSource = 'plan_mode'
  }

  return planMode
}

async function printSessionInfo(context: SlashCommandContext): Promise<void> {
  const meta = await loadSessionMeta(context.session.sessionId)
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
    ...(meta?.planMode ? [`plan mode state: ${meta.planMode.status}`] : []),
    ...(meta?.planMode?.planFilePath
      ? [`plan file: ${meta.planMode.planFilePath}`]
      : []),
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
  context: SlashCommandContext,
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

async function clearConversation(context: SlashCommandContext): Promise<void> {
  const meta = await loadSessionMeta(context.session.sessionId)
  const nextPermissionMode =
    context.session.permissionMode === 'plan'
      ? meta?.planMode?.resumePermissionMode ?? 'default'
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
    context.session.permissionModeSource = 'plan_mode'
  }

  printLines([
    'Started a new empty session.',
    `session id: ${nextSession.sessionId}`,
    ...(queryTracePath ? [`query trace: ${queryTracePath}`] : []),
    '',
  ])
}

function formatPlanModeSummary(planMode: PlanModeState | undefined): string[] {
  return [
    `plan mode: ${planMode?.status ?? 'inactive'}`,
    `plan file: ${planMode?.planFilePath ?? '<none>'}`,
  ]
}

async function showPlanState(context: SlashCommandContext): Promise<void> {
  const planMode = await syncPlanModeRuntime(context)
  if (!planMode?.planFilePath) {
    printLines([
      'No session plan file is attached yet.',
      'Use /plan to enter plan mode and create one.',
      '',
    ])
    return
  }

  const planContent = await readPlanFile(planMode.planFilePath)
  const planPreview = planContent
    ?.split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('#'))

  printLines([
    ...(planMode ? formatPlanModeSummary(planMode) : []),
    ...(existsSync(planMode.planFilePath)
      ? ['plan file status: ready']
      : ['plan file status: missing']),
    ...(planPreview ? [`plan preview: ${planPreview}`] : []),
    '',
  ])
}

async function enterPlanMode(context: SlashCommandContext): Promise<void> {
  const { filePath } = await ensureSessionPlanFile(context.session.sessionId)
  const updated = await updateSessionPlanMode(
    context.session.sessionId,
    current => ({
      ...(current ?? { status: 'inactive' as const }),
      status: 'active',
      planFilePath: filePath,
      needsExitReminder: false,
      resumePermissionMode:
        context.session.permissionMode === 'plan'
          ? current?.resumePermissionMode ?? 'default'
          : (context.session.permissionMode as PermissionMode),
    }),
  )

  context.engine.setPermissionMode('plan')
  context.engine.setPlanFilePath(updated?.planFilePath ?? filePath)
  context.session.permissionMode = 'plan'
  context.session.permissionModeSource = 'slash_command'
  await appendPlanSnapshotForFile(
    context.session.sessionId,
    updated?.planFilePath ?? filePath,
    'slash-enter-plan-mode',
  )

  printLines([
    'Entered plan mode for this interactive session.',
    ...formatPlanModeSummary(updated),
    '',
  ])
}

async function exitPlanMode(context: SlashCommandContext): Promise<void> {
  const meta = await loadSessionMeta(context.session.sessionId)
  const planMode = meta?.planMode
  if (!planMode || planMode.status !== 'active') {
    printLines([
      'Plan mode is already inactive.',
      '',
    ])
    return
  }

  const nextPermissionMode = planMode.resumePermissionMode ?? 'default'
  const updated = await updateSessionPlanMode(
    context.session.sessionId,
    current => ({
      ...(current ?? planMode),
      status: 'inactive',
      resumePermissionMode: undefined,
      needsExitReminder: false,
    }),
  )

  context.engine.setPermissionMode(nextPermissionMode)
  context.engine.setPlanFilePath(undefined)
  context.session.permissionMode = nextPermissionMode
  context.session.permissionModeSource = 'slash_command'
  await appendPlanSnapshotForFile(
    context.session.sessionId,
    updated?.planFilePath ?? planMode.planFilePath,
    'slash-exit-plan-mode',
  )

  printLines([
    `Exited plan mode. Restored permission mode: ${nextPermissionMode}`,
    ...formatPlanModeSummary(updated),
    '',
  ])
}

async function handlePlanCommand(
  args: string[],
  context: SlashCommandContext,
): Promise<void> {
  const subcommand = args[0]?.toLowerCase()

  if (subcommand === 'exit') {
    await exitPlanMode(context)
    return
  }

  if (subcommand === 'show' || subcommand === 'view' || subcommand === 'status') {
    await showPlanState(context)
    return
  }

  if (subcommand === 'enter') {
    await enterPlanMode(context)
    return
  }

  const meta = await loadSessionMeta(context.session.sessionId)
  if (meta?.planMode?.status === 'active' || context.session.permissionMode === 'plan') {
    await exitPlanMode(context)
    return
  }

  await enterPlanMode(context)
}

async function compactConversation(
  args: string[],
  context: SlashCommandContext,
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
  const { boundary, boundaryMessage, summaryMessage, messagesToKeep } = await compactSession({
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
    queryTraceSink: context.engine.getQueryTraceSink(),
    env: configured.env,
  })

  context.engine.preparePostCompactRecovery(boundary.boundaryId)
  context.engine.resetMessages([
    ...allMessages,
    boundaryMessage,
    summaryMessage,
    ...messagesToKeep,
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
  context: SlashCommandContext,
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
  context: SlashCommandContext,
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
      'Runtime switching is not available in this interactive context.',
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
    `Runtime updated for this interactive session: ${runtime.runtimeName ?? nextRuntime}`,
    ...formatRuntimeSummaryLines(runtime, queryTracePath),
    '',
  ])
}

function printCurrentPermissionMode(context: SlashCommandContext): void {
  printLines([
    `Current permission mode: ${context.session.permissionMode}`,
    `Available modes: ${ALL_PERMISSION_MODES.join(', ')}`,
    'Use /permissions <mode> to switch permission modes for this interactive session.',
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
  context: SlashCommandContext,
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
      'Skills are not available in this interactive context.',
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
  context: SlashCommandContext,
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
  context.session.permissionModeSource = 'slash_command'

  printLines([
    `Permission mode updated for this interactive session: ${nextPermissionMode}`,
    '',
  ])
}

async function printResumeSuggestions(context: SlashCommandContext): Promise<void> {
  const sessions = await listSessionHistory(context.options.cwd)
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
  lines.push('', 'Use /resume <session-id> to switch this interactive session to one of them.', '')
  printLines(lines)
}

async function resumeConversation(
  args: string[],
  context: SlashCommandContext,
): Promise<void> {
  const sessionId = args[0]?.trim()
  if (!sessionId) {
    await printResumeSuggestions(context)
    return
  }

  const env = context.env ?? process.env
  const resumed = await loadSessionForResume(sessionId, env)
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
  const planMode = await syncPlanModeRuntime(context)
  await updateSessionMeta(
    context.session.sessionId,
    meta => ({
      ...meta,
      runtimeName: context.session.runtimeName,
      provider: context.session.provider,
      model: context.session.model,
      updatedAt: new Date().toISOString(),
    }),
    env,
  )
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
    ...(planMode ? formatPlanModeSummary(planMode) : []),
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

const SLASH_COMMANDS: SlashCommandDefinition[] = [
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
      'Show or change the active permission mode for this interactive session.',
    presentationKind: 'structured_card',
    presentationTitle: 'Permissions',
    handle(args, context) {
      setCurrentPermissionMode(args, context)
    },
  },
  {
    name: '/plan',
    displayName: 'Plan',
    argumentHint: '[enter|exit|show]',
    argKind: 'enum',
    description: 'Toggle plan mode for this session, or show the current plan file.',
    presentationKind: 'structured_card',
    presentationTitle: 'Plan Mode',
    async handle(args, context) {
      await handlePlanCommand(args, context)
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
      'Resume a saved session inside the current interactive session, or list recent sessions when no id is provided.',
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
    description: 'Exit dclaw.',
    argKind: 'none',
    handle() {
      // The TUI handles /exit before slash command dispatch.
    },
  },
]

function findSlashCommand(name: string): SlashCommandDefinition | undefined {
  const normalized = name.toLowerCase()
  return SLASH_COMMANDS.find(
    command =>
      command.name.toLowerCase() === normalized ||
      command.aliases?.some(alias => alias.toLowerCase() === normalized),
  )
}

export function listSlashCommands(): SlashCommandCatalogItem[] {
  return SLASH_COMMANDS.map(command => ({
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

export async function maybeHandleSlashCommand(
  prompt: string,
  context: SlashCommandContext,
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
    const command = findSlashCommand(commandName)

    if (!command) {
      if (commandName.startsWith('/')) {
        printLines([
          `Unknown slash command: ${commandName}`,
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
