import type { InteractiveCommand } from './types.js'
import { formatVerboseContextLines } from './verboseEvents.js'
import { runInteractiveReplLoop } from './repl.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import { getCliErrorOutput } from './errorFormatting.js'
import { maybeHandleReplCommand } from './replCommands.js'
import { resolveInteractiveUiMode } from './interactiveUi.js'
import { runInteractiveTui } from './interactiveTui.js'
import { createInteractiveContext } from './interactiveContext.js'
import { createWelcomeCardData, formatWelcomeBanner } from './welcome.js'

type InteractiveRunners = {
  runLegacyRepl: (command: InteractiveCommand) => Promise<void>
  runTui: (command: InteractiveCommand) => Promise<void>
}

const defaultInteractiveRunners: InteractiveRunners = {
  runLegacyRepl: runInteractiveLegacyRepl,
  runTui: runInteractiveTui,
}

export async function runInteractive(
  command: InteractiveCommand,
  runners: InteractiveRunners = defaultInteractiveRunners,
): Promise<void> {
  const interactiveUi = resolveInteractiveUiMode(command.options.interactiveUi)
  if (interactiveUi === 'tui') {
    await runners.runTui(command)
    return
  }

  await runners.runLegacyRepl(command)
}

export async function runInteractiveLegacyRepl(
  command: InteractiveCommand,
): Promise<void> {
  const interactiveContext = await createInteractiveContext(command)
  const {
    runtime,
    version,
    replSession,
    replOptions,
    replContext,
    queryTracePath,
  } = interactiveContext
  const { permissionMode, permissionModeSource } = interactiveContext

  const welcomeCard = createWelcomeCardData({
    version,
    modelLabel: runtime.model ?? runtime.provider,
    cwd: command.options.cwd,
  })
  const lines = [formatWelcomeBanner(welcomeCard), '']

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
  } else {
    lines.push(`permission mode: ${permissionMode}`)
    if (!command.options.stream) {
      lines.push('stream: disabled')
    }
    if (queryTracePath) {
      lines.push(`query trace: ${queryTracePath}`)
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
          listSkillStatuses: replContext.listSkillStatuses,
          setSkillEnabled: replContext.setSkillEnabled,
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
          listSkillStatuses: replContext.listSkillStatuses,
          setSkillEnabled: replContext.setSkillEnabled,
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
            listSkillStatuses: replContext.listSkillStatuses,
            setSkillEnabled: replContext.setSkillEnabled,
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
  await interactiveContext.drainBackgroundWork()
}
