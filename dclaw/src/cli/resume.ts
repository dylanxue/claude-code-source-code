import { appendSessionMessages } from '../session/store.js'
import { loadSessionForResume } from '../session/resume.js'
import { formatTranscript } from '../session/transcript.js'
import { formatAssistantDebugOutput } from './assistantDebugOutput.js'
import { formatClaudeMdLoadOrder, prepareCliRuntime } from './runtime.js'
import type { ResumeCommand } from './types.js'

export async function runResume(command: ResumeCommand): Promise<void> {
  const resumed = await loadSessionForResume(command.sessionId)
  if (!resumed) {
    process.stderr.write(`Session not found: ${command.sessionId}\n`)
    process.exitCode = 1
    return
  }

  const { runtime, claudeMdEntries, toolRegistry, engine, queryTracePath } =
    await prepareCliRuntime(command.options, 'interactive', resumed.messages)
  const lines = [
    'dclaw resume mode is ready.',
    `session id: ${command.sessionId}`,
    `cwd: ${command.options.cwd}`,
    `restored messages: ${resumed.messages.length}`,
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
    lines.push(`resume prompt: ${command.prompt}`)
  } else {
    lines.push('resume prompt: <none>')
  }

  lines.push('')

  if (!command.prompt) {
    lines.push('restored transcript:')
    const transcriptLines = formatTranscript(resumed.messages, {
      includeThinking: command.options.verbose,
    })
    if (transcriptLines.length > 0) {
      lines.push(...transcriptLines)
    } else {
      lines.push('<empty>')
    }
    lines.push('')
    lines.push('No prompt provided yet. REPL loop will be added later.')
    process.stdout.write(lines.join('\n') + '\n')
    return
  }

  if (command.options.verbose && resumed.messages.length > 0) {
    lines.push('restored transcript preview:')
    lines.push(
      ...formatTranscript(resumed.messages, {
        includeThinking: true,
        maxMessages: 6,
      }),
    )
    lines.push('')
  }

  const initialMessageCount = engine.getMessages().length

  if (command.options.stream) {
    process.stdout.write(lines.join('\n') + '\n')
    const result = await engine.submitUserPromptWithHandlers(command.prompt, {
      onTextDelta(text) {
        process.stdout.write(text)
      },
    })
    await appendSessionMessages(
      resumed.meta.sessionId,
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
    resumed.meta.sessionId,
    result.messages.slice(initialMessageCount),
  )
  lines.push('assistant response:')
  lines.push(result.outputText)
  if (command.options.verbose) {
    lines.push(...formatAssistantDebugOutput(result.messages.slice(initialMessageCount)))
  }

  process.stdout.write(lines.join('\n') + '\n')
}
