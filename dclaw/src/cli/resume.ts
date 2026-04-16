import { isPersistedToolResultOutput } from '../core/toolResultBudget.js'
import { loadSessionForResume } from '../session/resume.js'
import type { SessionPersistedToolResultRecord } from '../session/store.js'
import { formatTranscript } from '../session/transcript.js'
import type { Message } from '../types/message.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import { runInteractiveReplLoop } from './repl.js'
import { maybeHandleReplCommand } from './replCommands.js'
import { prepareCliRuntime } from './runtime.js'
import type { ResumeCommand } from './types.js'
import { formatVerboseContextLines } from './verboseEvents.js'

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
    claudeMdEntries,
    toolRegistry,
    engine,
    queryTracePath,
    permissionMode,
    permissionModeSource,
  } = await prepareCliRuntime(command.options, 'interactive', resumed.messages)
  const persistedToolResultInfo =
    getPersistedToolResultInfoFromMeta(resumed.meta.persistedToolResults) ??
    getPersistedToolResultInfo(resumed.messages)

  const lines = [
    'dclaw resume mode is ready.',
    `session id: ${command.sessionId}`,
    `cwd: ${command.options.cwd}`,
    `restored messages: ${resumed.messages.length}`,
    `provider: ${runtime.provider}`,
    `provider source: ${runtime.providerSource}`,
    `model: ${runtime.model ?? 'default'}`,
    `model source: ${runtime.modelSource}`,
    `permission mode: ${permissionMode}`,
    `permission mode source: ${permissionModeSource}`,
    `stream: ${command.options.stream ? 'enabled' : 'disabled'}`,
  ]

  if (persistedToolResultInfo.count > 0) {
    lines.push(`persisted tool results: ${persistedToolResultInfo.count}`)
    if (persistedToolResultInfo.lastPath) {
      lines.push(
        `last persisted tool result: ${persistedToolResultInfo.lastPath}`,
      )
    }
  }

  if (command.options.systemPrompt) {
    lines.push('system prompt override: enabled')
  }
  lines.push(`claude.md files loaded: ${claudeMdEntries.length}`)
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
        sessionId: command.sessionId,
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
    onPrompt: async prompt => {
      if (
        await maybeHandleReplCommand(prompt, {
          engine,
          options: command.options,
          mode: 'resume',
        })
      ) {
        return
      }

      await runInteractiveSessionPrompt({
        engine,
        sessionId: resumed.meta.sessionId,
        prompt,
        stream: command.options.stream,
        verbose: command.options.verbose,
      })
    },
  })
}
