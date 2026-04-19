import { appendSessionMessages } from '../session/store.js'
import type { QueryEngine } from '../core/queryEngine.js'
import {
  formatAutoCompactLine,
  formatCompactDryRunLine,
  formatLlmErrorLine,
  formatProgressReasoningLines,
  formatProgressThinkingLine,
  formatProgressToolResultLine,
  formatProgressToolUseLine,
  formatToolUseLine,
  formatVerboseLines,
  formatVerboseMessageLines,
  formatReasoningDeltaPrefix,
} from './verboseEvents.js'

export type InteractiveSessionPromptOptions = {
  engine: QueryEngine
  sessionId: string
  prompt: string
  stream: boolean
  verbose: boolean
  env?: NodeJS.ProcessEnv
}

export type InteractiveSessionPromptResult = {
  sessionId: string
  autoCompact?: {
    sessionId: string
    boundaryId: string
    reason: string
    summaryMessageId: string
  }
}

export async function runInteractiveSessionPrompt(
  options: InteractiveSessionPromptOptions,
): Promise<InteractiveSessionPromptResult> {
  const initialMessageCount = options.engine.getMessages().length
  const persistPartialTurnIfNeeded = async (): Promise<void> => {
    const activeSessionId = options.engine.getSessionId() ?? options.sessionId
    const partialMessages = options.engine
      .getMessages()
      .slice(initialMessageCount)
    if (partialMessages.length === 0) {
      return
    }

    await appendSessionMessages(
      activeSessionId,
      partialMessages,
      options.env,
    ).catch(() => undefined)
  }

  if (options.stream || !options.verbose) {
    let outputEndsWithNewline = true
    let activeReasoningKind: 'reasoning' | 'thinking' | null = null
    const streamedReasoningIterations = new Set<number>()
    const activeToolUses = new Map<string, string>()
    const writeEventTextLines = (lines: string[]): void => {
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
    if (!options.verbose) {
      writeEventTextLines([formatProgressThinkingLine()])
    }

    let result
    try {
      result = await options.engine.submitUserPromptWithHandlers(
        options.prompt,
        {
          onTextDelta(text) {
            if (!options.stream) {
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
            if (!options.verbose || delta.text.length === 0) {
              return
            }

            streamedReasoningIterations.add(delta.iteration)
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
            if (options.verbose) {
              if (streamedReasoningIterations.has(message.iteration)) {
                return
              }

              writeEventTextLines(
                formatVerboseMessageLines(message, {
                  includeToolCalls: false,
                  includeReasoning: true,
                  includeContent: false,
                }),
              )
              return
            }

            writeEventTextLines(formatProgressReasoningLines(message))
          },
          onToolUse(toolUse) {
            activeToolUses.set(toolUse.id, toolUse.name)

            if (options.verbose) {
              writeEventTextLines([formatToolUseLine(toolUse)])
              return
            }

            writeEventTextLines([formatProgressToolUseLine(toolUse)])
          },
          onToolResult(toolResult) {
            if (options.verbose) {
              return
            }

            writeEventTextLines([
              formatProgressToolResultLine(
                activeToolUses.get(toolResult.toolUseId),
                toolResult.output,
              ),
              formatProgressThinkingLine(),
            ])
          },
          onLlmError(error) {
            if (!options.verbose) {
              return
            }

            writeEventTextLines([formatLlmErrorLine(error)])
          },
          onCompactDryRun(event) {
            if (!options.verbose) {
              return
            }

            writeEventTextLines([formatCompactDryRunLine(event)])
          },
          onAutoCompact(event) {
            writeEventTextLines([formatAutoCompactLine(event)])
          },
        },
      )
    } catch (error) {
      await persistPartialTurnIfNeeded()
      throw error
    }

    const activeSessionId = options.engine.getSessionId() ?? options.sessionId
    await appendSessionMessages(
      activeSessionId,
      result.appendedMessages,
      options.env,
    )
    if (options.stream) {
      if (!outputEndsWithNewline) {
        process.stdout.write('\n')
      }
    } else if (result.outputText.length > 0) {
      process.stdout.write(result.outputText)
      if (!result.outputText.endsWith('\n')) {
        process.stdout.write('\n')
      }
    }
    return {
      sessionId: activeSessionId,
      ...(result.autoCompact ? { autoCompact: result.autoCompact } : {}),
    }
  }

  let result
  try {
    result = await options.engine.submitUserPrompt(options.prompt)
  } catch (error) {
    await persistPartialTurnIfNeeded()
    throw error
  }
  const activeSessionId = options.engine.getSessionId() ?? options.sessionId
  await appendSessionMessages(
    activeSessionId,
    result.appendedMessages,
    options.env,
  )

  if (options.verbose) {
    const verboseLines = formatVerboseLines(result.appendedMessages, {
      includeToolCalls: true,
      includeReasoning: true,
      includeContent: true,
    })
    process.stdout.write(
      (verboseLines.length > 0 ? verboseLines.join('\n') : result.outputText) +
        '\n',
    )
    return {
      sessionId: activeSessionId,
      ...(result.autoCompact ? { autoCompact: result.autoCompact } : {}),
    }
  }

  process.stdout.write(result.outputText + '\n')
  return {
    sessionId: activeSessionId,
    ...(result.autoCompact ? { autoCompact: result.autoCompact } : {}),
  }
}
