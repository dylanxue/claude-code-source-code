import {
  getCompactBoundaryMessages,
  getLastCompactBoundary,
} from '../compact/boundaryMessage.js'
import { formatCompactBoundaryLabel } from '../compact/types.js'
import { isPersistedToolResultOutput } from '../core/toolResultBudget.js'
import { loadSessionForResume } from '../session/resume.js'
import type { SessionSubagentSummary } from '../agent/observability.js'
import {
  loadSessionMeta,
  type PlanModeState,
  type SessionPersistedToolResultRecord,
} from '../session/store.js'
import { formatTranscript } from '../session/transcript.js'
import { recoverSessionPlanFile } from '../planboard/planSnapshots.js'
import type { Message } from '../types/message.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import type { InteractiveSessionState } from './slashCommands.js'
import { prepareCliRuntime } from './runtime.js'
import { getCliErrorOutput } from './errorFormatting.js'
import type { ResumeCommand } from './types.js'

function formatSubagentSummaryLines(
  subagents: SessionSubagentSummary,
): string[] {
  if (subagents.count === 0) {
    return []
  }

  const parts = [
    `subagents: ${subagents.count}`,
    subagents.queuedCount > 0 ? `queued ${subagents.queuedCount}` : undefined,
    subagents.runningCount > 0 ? `running ${subagents.runningCount}` : undefined,
    subagents.completedCount > 0
      ? `completed ${subagents.completedCount}`
      : undefined,
    subagents.failedCount > 0 ? `failed ${subagents.failedCount}` : undefined,
    subagents.stoppedCount > 0 ? `stopped ${subagents.stoppedCount}` : undefined,
  ].filter((part): part is string => Boolean(part))

  return [
    parts.join('  '),
    ...(subagents.lastStatus && subagents.lastTask
      ? [`last subagent: ${subagents.lastStatus}  ${subagents.lastTask}`]
      : []),
    ...(subagents.lastTracePath
      ? [`last subagent trace: ${subagents.lastTracePath}`]
      : []),
  ]
}

function formatPlanModeLines(planMode: PlanModeState | undefined): string[] {
  if (!planMode) {
    return []
  }

  return [
    `plan mode: ${planMode.status}`,
    ...(planMode.planFilePath ? [`plan file: ${planMode.planFilePath}`] : []),
  ]
}

function getPersistedToolResultInfo(messages: Message[]): {
  count: number
  lastPath?: string
} {
  let count = 0
  let lastPath: string | undefined

  for (const message of messages) {
    for (const block of message.content) {
      if (
        block.type === 'tool_result' &&
        isPersistedToolResultOutput(block.output)
      ) {
        count += 1
        lastPath = block.output.filepath
      }
    }
  }

  return { count, lastPath }
}

function getPersistedToolResultInfoFromMeta(
  records: SessionPersistedToolResultRecord[] | undefined,
): {
  count: number
  lastPath?: string
} | null {
  if (!records || records.length === 0) {
    return null
  }

  return {
    count: records.length,
    lastPath: records.at(-1)?.filepath,
  }
}

export async function runResume(command: ResumeCommand): Promise<void> {
  const resumed = await loadSessionForResume(command.sessionId)
  if (!resumed) {
    process.stderr.write(`Session not found: ${command.sessionId}\n`)
    process.exitCode = 1
    return
  }

  const {
    runtime,
    dclawMdEntries,
    toolRegistry,
    engine,
    rotateQueryTrace,
    drainBackgroundWork,
    permissionMode,
    permissionModeSource,
    env,
  } = await prepareCliRuntime(command.options, 'interactive', resumed.messages)
  const persistedToolResultInfo =
    getPersistedToolResultInfoFromMeta(resumed.meta.persistedToolResults) ??
    getPersistedToolResultInfo(resumed.messages)
  const interactiveSession: InteractiveSessionState = {
    sessionId: resumed.meta.sessionId,
    mode: 'resume',
    runtimeName: runtime.runtimeName,
    provider: runtime.provider,
    providerSource: runtime.providerSource,
    model: runtime.model,
    modelSource: runtime.modelSource,
    permissionMode,
    permissionModeSource,
  }
  engine.setSessionId(interactiveSession.sessionId)
  const queryTracePath = await rotateQueryTrace(interactiveSession.sessionId)
  await recoverSessionPlanFile(interactiveSession.sessionId, resumed.messages, env)
  const resumedMeta = await loadSessionMeta(interactiveSession.sessionId, env)
  const planMode = resumedMeta?.planMode
  if (planMode?.status === 'active') {
    engine.setPermissionMode('plan')
    engine.setPlanFilePath(planMode.planFilePath)
    interactiveSession.permissionMode = 'plan'
    interactiveSession.permissionModeSource = 'plan_mode'
  }
  const lines = [
    'dclaw resume mode is ready.',
    `session id: ${command.sessionId}`,
    `cwd: ${command.options.cwd}`,
    `restored messages: ${resumed.messages.length}`,
    `runtime: ${runtime.runtimeName ?? 'stub'}`,
    `runtime source: ${runtime.runtimeSource}`,
    `provider: ${runtime.provider}`,
    `provider source: ${runtime.providerSource}`,
    `model: ${runtime.model ?? 'default'}`,
    `model source: ${runtime.modelSource}`,
    ...(runtime.model && runtime.canonicalModel && runtime.canonicalModel !== runtime.model
      ? [`model canonicalized to: ${runtime.canonicalModel}`]
      : []),
    ...(runtime.model
      ? [`catalog match: ${runtime.catalogMatch ?? 'none'}`]
      : []),
    `image input: ${runtime.primary.modelCapabilities.supportsImageInput ? 'supported' : 'not supported'}`,
    `vision side query: ${runtime.imageFallback ? `${runtime.imageFallback.provider} / ${runtime.imageFallback.model ?? 'default'}` : 'not configured'}`,
    `permission mode: ${interactiveSession.permissionMode}`,
    `permission mode source: ${interactiveSession.permissionModeSource}`,
    `stream: ${command.options.stream ? 'enabled' : 'disabled'}`,
    ...formatPlanModeLines(planMode),
    ...formatSubagentSummaryLines(resumed.subagents),
  ]

  if (persistedToolResultInfo.count > 0) {
    lines.push(`persisted tool results: ${persistedToolResultInfo.count}`)
    if (persistedToolResultInfo.lastPath) {
      lines.push(
        `last persisted tool result: ${persistedToolResultInfo.lastPath}`,
      )
    }
  }
  const compactBoundaries = getCompactBoundaryMessages(resumed.messages)
  const lastCompactBoundary = getLastCompactBoundary(resumed.messages)
  if (compactBoundaries.length > 0) {
    lines.push(`compact boundaries: ${compactBoundaries.length}`)
  }
  if (lastCompactBoundary) {
    lines.push(
      `last compact boundary: ${formatCompactBoundaryLabel(lastCompactBoundary)}`,
    )
  }

  if (command.options.systemPrompt) {
    lines.push('system prompt override: enabled')
  }
  lines.push(`dclaw.md files loaded: ${dclawMdEntries.length}`)
  lines.push(`tools loaded: ${toolRegistry.list().length}`)
  if (queryTracePath) {
    lines.push(`query trace: ${queryTracePath}`)
  }
  lines.push(`resume prompt: ${command.prompt ?? '<none>'}`)
  lines.push('')

  if (!command.prompt) {
    lines.push('restored transcript:')
    const transcriptLines = formatTranscript(resumed.messages, {
      includeThinking: false,
    })
    if (transcriptLines.length > 0) {
      lines.push(...transcriptLines)
    } else {
      lines.push('<empty>')
    }
    lines.push('')
  }

  process.stdout.write(lines.join('\n') + '\n')

  if (!command.prompt) {
    return
  }

  try {
    await runInteractiveSessionPrompt({
      engine,
      sessionId: interactiveSession.sessionId,
      prompt: command.prompt,
      stream: command.options.stream,
      env,
    })
  } catch (error) {
    const output = getCliErrorOutput(command, error)
    if (output.stream === 'stdout') {
      process.stdout.write(output.text)
    } else {
      process.stderr.write(output.text)
    }
  } finally {
    await drainBackgroundWork()
  }
}
