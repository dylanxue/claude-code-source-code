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
  const {
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

  const lines = [
    'dclaw interactive mode is ready.',
    `cwd: ${command.options.cwd}`,
    `provider: ${runtime.provider}`,
    `provider source: ${runtime.providerSource}`,
    `model: ${runtime.model ?? 'default'}`,
    `model source: ${runtime.modelSource}`,
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
    onPrompt: async prompt => {
      if (
        await maybeHandleReplCommand(prompt, {
          engine,
          options: command.options,
          session: replSession,
          rotateQueryTrace,
        })
      ) {
        return
      }

      const result = await runInteractiveSessionPrompt({
        engine,
        sessionId: replSession.sessionId,
        prompt,
        stream: command.options.stream,
        verbose: command.options.verbose,
      })
      replSession.sessionId = result.sessionId
      const runtimePermissionMode = engine.getPermissionMode()
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
  })
  await drainBackgroundWork()
}
