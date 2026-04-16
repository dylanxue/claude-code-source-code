import { appendSessionMessages, createSession } from '../session/store.js'
import { formatAssistantDebugOutput } from './assistantDebugOutput.js'
import { formatClaudeMdLoadOrder, prepareCliRuntime } from './runtime.js'
import type { InteractiveCommand } from './types.js'

export async function runInteractive(command: InteractiveCommand): Promise<void> {
  const { runtime, claudeMdEntries, toolRegistry, engine, queryTracePath } =
    await prepareCliRuntime(command.options, 'interactive')

  const lines = [
    'dclaw interactive mode is ready.',
    `cwd: ${command.options.cwd}`,
    `provider: ${runtime.provider}`,
    `provider source: ${runtime.providerSource}`,
    `model: ${runtime.model ?? 'default'}`,
    `model source: ${runtime.modelSource}`,
    `permission mode: ${command.options.permissionMode}`,
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
  if (command.options.verbose && claudeMdEntries.length > 0) {
    lines.push(...formatClaudeMdLoadOrder(claudeMdEntries))
  }
  if (command.prompt) {
    lines.push(`initial prompt: ${command.prompt}`)
  } else {
    lines.push('initial prompt: <none>')
  }

  lines.push('')
  if (command.prompt) {
    const session = await createSession({
      cwd: command.options.cwd,
      mode: 'interactive',
      provider: runtime.provider,
      model: runtime.model,
    })
    const initialMessageCount = engine.getMessages().length

    if (command.options.stream) {
      process.stdout.write(lines.join('\n') + '\n')
      const result = await engine.submitUserPromptWithHandlers(command.prompt, {
        onTextDelta(text) {
          process.stdout.write(text)
        },
      })
      await appendSessionMessages(
        session.sessionId,
        result.messages.slice(initialMessageCount),
      )
      const assistantDebugLines = command.options.verbose
        ? formatAssistantDebugOutput(result.messages.slice(initialMessageCount))
        : []
      if (!result.outputText.endsWith('\n')) {
        process.stdout.write('\n')
      }
      if (assistantDebugLines.length > 0) {
        process.stdout.write(assistantDebugLines.join('\n') + '\n')
      }
      return
    }

    const result = await engine.submitUserPrompt(command.prompt)
    await appendSessionMessages(
      session.sessionId,
      result.messages.slice(initialMessageCount),
    )
    lines.push('assistant response:')
    lines.push(result.outputText)
    if (command.options.verbose) {
      lines.push(...formatAssistantDebugOutput(result.messages.slice(initialMessageCount)))
    }
  } else {
    lines.push('No prompt provided yet. REPL loop will be added later.')
  }

  process.stdout.write(lines.join('\n') + '\n')
}
