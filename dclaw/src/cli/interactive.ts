import { createSession } from '../session/store.js'
import { prepareCliRuntime } from './runtime.js'
import type { InteractiveCommand } from './types.js'
import { formatVerboseContextLines } from './verboseEvents.js'
import { runInteractiveReplLoop } from './repl.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import { getCliErrorOutput } from './errorFormatting.js'
import {
  maybeHandleReplCommand,
  type ReplSessionState,
} from './replCommands.js'

export async function runInteractive(command: InteractiveCommand): Promise<void> {
  let {
    runtime,
    dclawMdEntries,
    toolRegistry,
    engine,
    rotateQueryTrace,
    drainBackgroundWork,
    permissionMode,
    permissionModeSource,
  } = await prepareCliRuntime(command.options, 'interactive')

  const session = await createSession({
    cwd: command.options.cwd,
    mode: 'interactive',
    provider: runtime.provider,
    model: runtime.model,
  })
  engine.setSessionId(session.sessionId)
  const queryTracePath = await rotateQueryTrace(session.sessionId)
  const replSession: ReplSessionState = {
    sessionId: session.sessionId,
    mode: 'interactive',
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

  const lines = [
    'dclaw interactive mode is ready.',
    `cwd: ${command.options.cwd}`,
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
    `permission mode: ${permissionMode}`,
    `permission mode source: ${permissionModeSource}`,
    `stream: ${command.options.stream ? 'enabled' : 'disabled'}`,
  ]

  if (command.options.systemPrompt) {
    lines.push('system prompt override: enabled')
  }
  lines.push(`dclaw.md files loaded: ${dclawMdEntries.length}`)
  lines.push(`tools loaded: ${toolRegistry.list().length}`)
  if (queryTracePath) {
    lines.push(`query trace: ${queryTracePath}`)
  }
  lines.push(`initial prompt: ${command.prompt ?? '<none>'}`)
  lines.push('')

  if (command.options.verbose) {
    lines.push(
      ...formatVerboseContextLines({
        mode: 'interactive',
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
