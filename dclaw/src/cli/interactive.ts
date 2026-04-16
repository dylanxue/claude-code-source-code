import { createSession } from '../session/store.js'
import { prepareCliRuntime } from './runtime.js'
import type { InteractiveCommand } from './types.js'
import { formatVerboseContextLines } from './verboseEvents.js'
import { runInteractiveReplLoop } from './repl.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import { maybeHandleReplCommand } from './replCommands.js'

export async function runInteractive(command: InteractiveCommand): Promise<void> {
  const {
    runtime,
    claudeMdEntries,
    toolRegistry,
    engine,
    queryTracePath,
    permissionMode,
    permissionModeSource,
  } = await prepareCliRuntime(command.options, 'interactive')

  const session = await createSession({
    cwd: command.options.cwd,
    mode: 'interactive',
    provider: runtime.provider,
    model: runtime.model,
  })

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
  lines.push(`claude.md files loaded: ${claudeMdEntries.length}`)
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
        sessionId: session.sessionId,
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
          mode: 'interactive',
        })
      ) {
        return
      }

      await runInteractiveSessionPrompt({
        engine,
        sessionId: session.sessionId,
        prompt,
        stream: command.options.stream,
        verbose: command.options.verbose,
      })
    },
  })
}
