import {
  getCompactBoundaryMessages,
  getLastCompactBoundary,
} from '../compact/boundaryMessage.js'
import { formatCompactBoundaryLabel } from '../compact/types.js'
import { isPersistedToolResultOutput } from '../core/toolResultBudget.js'
import { loadSessionForResume } from '../session/resume.js'
import type { SessionSubagentSummary } from '../agent/observability.js'
import type { SessionPersistedToolResultRecord } from '../session/store.js'
import { formatTranscript } from '../session/transcript.js'
import { getTaskBoardObservationLines } from '../tasks/observability.js'
import { recoverTaskBoardPlanFile } from '../tasks/planSnapshots.js'
import { loadTaskBoardForSession } from '../tasks/store.js'
import type { Message } from '../types/message.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import { runInteractiveReplLoop } from './repl.js'
import {
  maybeHandleReplCommand,
  type ReplSessionState,
} from './replCommands.js'
import { prepareCliRuntime } from './runtime.js'
import { getCliErrorOutput } from './errorFormatting.js'
import type { ResumeCommand } from './types.js'
import { formatVerboseContextLines } from './verboseEvents.js'

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

  let {
    runtime,
    dclawMdEntries,
    toolRegistry,
    engine,
    rotateQueryTrace,
    drainBackgroundWork,
    permissionMode,
    permissionModeSource,
  } = await prepareCliRuntime(command.options, 'interactive', resumed.messages)
  const persistedToolResultInfo =
    getPersistedToolResultInfoFromMeta(resumed.meta.persistedToolResults) ??
    getPersistedToolResultInfo(resumed.messages)
  const replSession: ReplSessionState = {
    sessionId: resumed.meta.sessionId,
    mode: 'resume',
    provider: runtime.provider,
    providerSource: runtime.providerSource,
    model: runtime.model,
    modelSource: runtime.modelSource,
    permissionMode,
    permissionModeSource,
  }
  const replOptions = { ...command.options }
  const replContext = {
    engine,
    options: replOptions,
    session: replSession,
    rotateQueryTrace,
    switchRuntime: async (runtimeName: string) => {
      await drainBackgroundWork()
      const nextOptions = {
        ...replOptions,
        runtime: runtimeName,
        permissionMode: replSession.permissionMode as typeof replOptions.permissionMode,
      }
      const prepared = await prepareCliRuntime(
        nextOptions,
        'interactive',
        replContext.engine.getMessages(),
      )
      const nextEngine = prepared.engine
      nextEngine.setSessionId(replSession.sessionId)
      nextEngine.setPlanFilePath(replContext.engine.getPlanFilePath())
      nextEngine.setPermissionMode(replSession.permissionMode as typeof permissionMode)
      const nextQueryTracePath =
        await prepared.rotateQueryTrace(replSession.sessionId)

      runtime = prepared.runtime
      dclawMdEntries = prepared.dclawMdEntries
      toolRegistry = prepared.toolRegistry
      engine = nextEngine
      rotateQueryTrace = prepared.rotateQueryTrace
      drainBackgroundWork = prepared.drainBackgroundWork
      permissionMode = replSession.permissionMode as typeof permissionMode
      permissionModeSource = replSession.permissionModeSource as typeof permissionModeSource
      replOptions.runtime = runtimeName
      replContext.engine = nextEngine
      replContext.rotateQueryTrace = prepared.rotateQueryTrace
      replSession.provider = runtime.provider
      replSession.providerSource = runtime.providerSource
      replSession.model = runtime.model
      replSession.modelSource = runtime.modelSource

      return {
        runtime,
        queryTracePath: nextQueryTracePath,
      }
    },
  }
  engine.setSessionId(replSession.sessionId)
  const queryTracePath = await rotateQueryTrace(replSession.sessionId)
  const loadedTaskBoard = await loadTaskBoardForSession(replSession.sessionId)
  const taskBoard = loadedTaskBoard
    ? await recoverTaskBoardPlanFile(loadedTaskBoard, resumed.messages)
    : null
  if (taskBoard?.mode === 'active') {
    engine.setPermissionMode('plan')
    engine.setPlanFilePath(taskBoard.planFilePath)
    replSession.permissionMode = 'plan'
    replSession.permissionModeSource = 'task_board'
  }
  const lines = [
    'dclaw resume mode is ready.',
    `session id: ${command.sessionId}`,
    `cwd: ${command.options.cwd}`,
    `restored messages: ${resumed.messages.length}`,
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
    `permission mode: ${replSession.permissionMode}`,
    `permission mode source: ${replSession.permissionModeSource}`,
    `stream: ${command.options.stream ? 'enabled' : 'disabled'}`,
    ...(taskBoard ? getTaskBoardObservationLines(taskBoard) : []),
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
  if (command.options.verbose) {
    lines.push(
      ...formatVerboseContextLines({
        mode: 'resume',
        cwd: command.options.cwd,
        provider: runtime.provider,
        providerSource: runtime.providerSource,
        model: runtime.model,
        modelSource: runtime.modelSource,
        permissionMode,
        permissionModeSource,
        stream: command.options.stream,
        outputFormat: command.options.outputFormat,
        sessionId: replSession.sessionId,
        queryTracePath,
      }),
    )
  }

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

  if (!command.prompt && !process.stdin.isTTY) {
    process.stdout.write(
      'Interactive REPL requires a TTY when no prompt is provided.\n',
    )
    return
  }

  await runInteractiveReplLoop({
    initialPrompt: command.prompt,
    async onImmediatePrompt(prompt, control) {
      try {
        return await maybeHandleReplCommand(prompt, {
          engine: replContext.engine,
          options: replContext.options,
          session: replContext.session,
          rotateQueryTrace: replContext.rotateQueryTrace,
          switchRuntime: replContext.switchRuntime,
        }, {
          writeOutput: control.writeOutput,
        })
      } finally {
        control.flushOutput()
      }
    },
    onPrompt: async (prompt, control) => {
      if (
        await maybeHandleReplCommand(prompt, {
          engine: replContext.engine,
          options: replContext.options,
          session: replContext.session,
          rotateQueryTrace: replContext.rotateQueryTrace,
          switchRuntime: replContext.switchRuntime,
        })
      ) {
        return
      }

      const result = await runInteractiveSessionPrompt({
        engine: replContext.engine,
        sessionId: replSession.sessionId,
        prompt,
        stream: replContext.options.stream,
        verbose: replContext.options.verbose,
        signal: control.signal,
        writeOutput: control.writeOutput,
        flushOutput: control.flushOutput,
      })
      replSession.sessionId = result.sessionId
      const runtimePermissionMode = replContext.engine.getPermissionMode()
      if (runtimePermissionMode !== replSession.permissionMode) {
        replSession.permissionMode = runtimePermissionMode
        replSession.permissionModeSource = 'tool_runtime'
      }
    },
    onPromptError(error) {
      const output = getCliErrorOutput(command, error)
      if (output.stream === 'stdout') {
        process.stdout.write(output.text)
        return
      }

      process.stderr.write(output.text)
    },
    async onBusyPrompt(prompt, busy) {
      try {
        return await maybeHandleReplCommand(
          prompt,
          {
            engine: replContext.engine,
            options: replContext.options,
            session: replContext.session,
            rotateQueryTrace: replContext.rotateQueryTrace,
            switchRuntime: replContext.switchRuntime,
          },
          {
            allowDuringActivePrompt: true,
            writeOutput: busy.writeOutput,
          },
        )
      } finally {
        busy.flushOutput()
      }
    },
    onPromptQueued(_prompt, pendingCount, writeOutput) {
      writeOutput(`Queued prompt. Pending prompts: ${pendingCount}\n`)
    },
    onPromptInterrupted(_prompt, writeOutput) {
      writeOutput('Current response interrupted.\n')
    },
  })
  await drainBackgroundWork()
}
