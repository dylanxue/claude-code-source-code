import { appendSessionMessages, createSession } from '../session/store.js'
import { prepareCliRuntime } from './runtime.js'
import type { PrintCommand } from './types.js'
import {
  formatAutoCompactLine,
  formatCompactDryRunLine,
  formatLlmErrorLine,
  formatToolUseLine,
  formatVerboseContextLines,
  formatVerboseLines,
  formatVerboseMessageLines,
  formatReasoningDeltaPrefix,
  getVerboseContentBlocks,
  getVerboseReasoningBlocks,
} from './verboseEvents.js'

function writeSseEvent(event: string, payload: unknown): void {
  process.stdout.write(`event: ${event}\n`)
  process.stdout.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function runHeadless(command: PrintCommand): Promise<void> {
  const prompt = command.prompt?.trim()

  if (!prompt) {
    process.stdout.write('No prompt provided.\n')
    return
  }

  const {
    runtime,
    engine,
    rotateQueryTrace,
    permissionMode,
    permissionModeSource,
  } = await prepareCliRuntime(
    command.options,
    'print',
  )
  const session = await createSession({
    cwd: command.options.cwd,
    mode: 'print',
    provider: runtime.provider,
    model: runtime.model,
  })
  engine.setSessionId(session.sessionId)
  const queryTracePath = await rotateQueryTrace(session.sessionId)
  const verboseContext = formatVerboseContextLines({
    mode: 'print',
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
  })
  let streamedText = ''
  let outputEndsWithNewline = true
  let activeReasoningKind: 'reasoning' | 'thinking' | null = null
  const streamedReasoningIterations = new Set<number>()
  const writeVerboseTextLines = (lines: string[]): void => {
    if (lines.length === 0) {
      return
    }

    if (activeReasoningKind) {
      process.stdout.write('\n')
      activeReasoningKind = null
      outputEndsWithNewline = true
    }
    if (!outputEndsWithNewline) {
      process.stdout.write('\n')
    }
    process.stdout.write(lines.join('\n') + '\n')
    outputEndsWithNewline = true
  }
  if (command.options.verbose) {
    if (command.options.outputFormat === 'sse') {
      writeSseEvent('response.meta', {
        mode: 'print',
        cwd: command.options.cwd,
        provider: runtime.provider,
        providerSource: runtime.providerSource,
        model: runtime.model ?? 'default',
        modelSource: runtime.modelSource,
        permissionMode,
        permissionModeSource,
        stream: command.options.stream,
        outputFormat: command.options.outputFormat,
        sessionId: session.sessionId,
        ...(queryTracePath ? { queryTracePath } : {}),
      })
    } else {
      writeVerboseTextLines(verboseContext)
      process.stdout.write('\n')
    }
  }
  const result = command.options.stream
    ? await engine.submitUserPromptWithHandlers(prompt, {
        onTextDelta(text) {
          streamedText += text
          if (command.options.outputFormat === 'sse') {
            writeSseEvent('assistant.delta', { text })
            return
          }

          if (activeReasoningKind) {
            process.stdout.write('\n')
            activeReasoningKind = null
            outputEndsWithNewline = true
          }
          process.stdout.write(text)
          if (text.length > 0) {
            outputEndsWithNewline = text.endsWith('\n')
          }
        },
        onReasoningDelta(delta) {
          if (!command.options.verbose || delta.text.length === 0) {
            return
          }

          streamedReasoningIterations.add(delta.iteration)
          if (command.options.outputFormat === 'sse') {
            writeSseEvent('assistant.reasoning.delta', delta)
            return
          }

          if (activeReasoningKind !== delta.kind) {
            if (!outputEndsWithNewline) {
              process.stdout.write('\n')
            }
            process.stdout.write(formatReasoningDeltaPrefix(delta.kind))
          }
          process.stdout.write(delta.text)
          activeReasoningKind = delta.text.endsWith('\n') ? null : delta.kind
          outputEndsWithNewline = delta.text.endsWith('\n')
        },
        onAssistantMessage(message) {
          if (command.options.outputFormat === 'sse') {
            if (command.options.verbose) {
              const reasoningBlocks = getVerboseReasoningBlocks(message.content)
              if (
                reasoningBlocks.length > 0 &&
                !streamedReasoningIterations.has(message.iteration)
              ) {
                writeSseEvent('assistant.reasoning', {
                  iteration: message.iteration,
                  messageId: message.id,
                  content: reasoningBlocks,
                })
              }
              const contentBlocks = getVerboseContentBlocks(message.content)
              if (contentBlocks.length > 0) {
                writeSseEvent('assistant.content', {
                  iteration: message.iteration,
                  messageId: message.id,
                  content: contentBlocks,
                })
              }
              return
            }

            writeSseEvent('assistant.message', message)
            const reasoningBlocks = message.content.filter(
              block =>
                block.type === 'reasoning' ||
                block.type === 'thinking' ||
                block.type === 'redacted_thinking',
            )
            if (reasoningBlocks.length > 0) {
              writeSseEvent('assistant.reasoning', {
                iteration: message.iteration,
                messageId: message.id,
                content: reasoningBlocks,
              })
            }
            return
          }

          if (!command.options.verbose) {
            return
          }
          if (streamedReasoningIterations.has(message.iteration)) {
            return
          }

          writeVerboseTextLines(
            formatVerboseMessageLines(message, {
              includeToolCalls: false,
              includeReasoning: true,
              includeContent: false,
            }),
          )
        },
        onToolUse(toolUse) {
          if (command.options.outputFormat === 'sse') {
            writeSseEvent('tool.use', toolUse)
            return
          }

          if (command.options.verbose) {
            writeVerboseTextLines([formatToolUseLine(toolUse)])
          }
        },
        onToolResult(toolResult) {
          if (
            command.options.outputFormat === 'sse' &&
            !command.options.verbose
          ) {
            writeSseEvent('tool.result', toolResult)
          }
        },
        onLlmError(error) {
          if (!command.options.verbose) {
            return
          }

          if (command.options.outputFormat === 'sse') {
            writeSseEvent('llm.error', error)
            return
          }

          writeVerboseTextLines([formatLlmErrorLine(error)])
        },
        onCompactDryRun(event) {
          if (!command.options.verbose) {
            return
          }

          if (command.options.outputFormat === 'sse') {
            writeSseEvent('compact.dry_run', event)
            return
          }

          writeVerboseTextLines([formatCompactDryRunLine(event)])
        },
        onAutoCompact(event) {
          if (command.options.outputFormat === 'sse') {
            writeSseEvent('compact.auto', event)
            return
          }

          writeVerboseTextLines([formatAutoCompactLine(event)])
        },
      })
    : await engine.submitUserPrompt(prompt)

  const activeSessionId = engine.getSessionId() ?? session.sessionId
  await appendSessionMessages(
    activeSessionId,
    result.appendedMessages,
  )
  const addedMessages = result.appendedMessages

  if (command.options.outputFormat === 'sse') {
    writeSseEvent('response.complete', {
      outputText: result.outputText,
      iterations: result.appendedMessages.length,
      assistantMessage: result.assistantMessage,
    })
    return
  }

  if (command.options.verbose) {
    if (command.options.stream) {
      if (!outputEndsWithNewline) {
        process.stdout.write('\n')
      }
      return
    }

    const verboseLines = formatVerboseLines(addedMessages, {
      includeToolCalls: true,
      includeReasoning: true,
      includeContent: true,
    })
    process.stdout.write(
      (verboseLines.length > 0 ? verboseLines.join('\n') : result.outputText) + '\n',
    )
    return
  }

  if (!command.options.stream || streamedText.length === 0) {
    process.stdout.write(result.outputText + '\n')
    return
  }

  if (!streamedText.endsWith('\n')) {
    process.stdout.write('\n')
  }
}
