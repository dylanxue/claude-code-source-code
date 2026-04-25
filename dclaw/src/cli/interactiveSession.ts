import { appendSessionMessages } from '../session/store.js'
import type { QueryEngine } from '../core/queryEngine.js'
import {
  collectProgressAssistantTexts,
  formatAutoCompactLine,
  formatCompactDryRunLine,
  formatProgressAssistantLines,
  formatProgressAssistantOutputLines,
  formatLlmErrorLine,
  formatProgressThinkingLine,
  formatProgressToolResultDisplayLine,
  formatProgressToolUseDisplayLine,
  formatToolUseLine,
  formatVerboseToolResultLine,
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
  signal?: AbortSignal
  writeOutput?: (text: string) => void
  flushOutput?: () => void
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
  const writeOutput =
    options.writeOutput ?? ((text: string) => {
      process.stdout.write(text)
    })
  const flushOutput = options.flushOutput ?? (() => {})
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
    let assistantTextStreamStarted = false
    let assistantMessageHadStreamedText = false
    let activeReasoningKind: 'reasoning' | 'thinking' | null = null
    const streamedReasoningIterations = new Set<number>()
    const activeToolUses = new Map<
      string,
      { name: string; input: Record<string, unknown> }
    >()
    const displayedAssistantTexts = new Set<string>()
    let pendingReasoningLines: string[] = []
    const writeEventTextLines = (lines: string[]): void => {
      if (lines.length === 0) {
        return
      }

      if (activeReasoningKind) {
        writeOutput('\n')
        activeReasoningKind = null
        outputEndsWithNewline = true
      }
      if (!outputEndsWithNewline) {
        writeOutput('\n')
      }
      writeOutput(lines.join('\n') + '\n')
      outputEndsWithNewline = true
    }
    let genericThinkingTimer: ReturnType<typeof setTimeout> | undefined
    let pendingReasoningTimer: ReturnType<typeof setTimeout> | undefined
    let hasConcreteProgress = false
    const clearGenericThinkingTimer = (): void => {
      if (!genericThinkingTimer) {
        return
      }

      clearTimeout(genericThinkingTimer)
      genericThinkingTimer = undefined
    }
    const clearPendingReasoningTimer = (): void => {
      if (!pendingReasoningTimer) {
        return
      }

      clearTimeout(pendingReasoningTimer)
      pendingReasoningTimer = undefined
    }
    const markConcreteProgress = (): void => {
      hasConcreteProgress = true
      clearGenericThinkingTimer()
      clearPendingReasoningTimer()
      pendingReasoningLines = []
    }
    const flushPendingReasoning = (): void => {
      if (pendingReasoningLines.length === 0) {
        return
      }

      writeEventTextLines(pendingReasoningLines)
      pendingReasoningLines = []
      pendingReasoningTimer = undefined
      hasConcreteProgress = true
    }
    const schedulePendingReasoning = (lines: string[]): void => {
      if (lines.length === 0) {
        return
      }

      pendingReasoningLines = lines
      clearGenericThinkingTimer()
      clearPendingReasoningTimer()
      pendingReasoningTimer = setTimeout(() => {
        flushPendingReasoning()
      }, 200)
      pendingReasoningTimer.unref?.()
    }
    const scheduleGenericThinking = (): void => {
      if (options.verbose || hasConcreteProgress || genericThinkingTimer) {
        return
      }

      genericThinkingTimer = setTimeout(() => {
        genericThinkingTimer = undefined
        if (!hasConcreteProgress) {
          writeEventTextLines([`Assistant: ${formatProgressThinkingLine()}`])
        }
      }, 250)
      genericThinkingTimer.unref?.()
    }

    if (!options.verbose) {
      scheduleGenericThinking()
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
              writeOutput('\n')
              activeReasoningKind = null
              outputEndsWithNewline = true
            }
            if (!options.verbose && !assistantTextStreamStarted) {
              if (!outputEndsWithNewline) {
                writeOutput('\n')
              }
              writeOutput('Assistant: ')
              assistantTextStreamStarted = true
              outputEndsWithNewline = false
            }
            writeOutput(text)
            if (text.length > 0) {
              assistantMessageHadStreamedText = true
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
                writeOutput('\n')
              }
              writeOutput(formatReasoningDeltaPrefix(delta.kind))
            }
            writeOutput(delta.text)
            activeReasoningKind = delta.text.endsWith('\n') ? null : delta.kind
            outputEndsWithNewline = delta.text.endsWith('\n')
          },
          onAssistantMessage(message) {
            if (options.verbose) {
              if (streamedReasoningIterations.has(message.iteration)) {
                return
              }

              markConcreteProgress()
              writeEventTextLines(
                formatVerboseMessageLines(message, {
                  includeToolCalls: false,
                  includeReasoning: true,
                  includeContent: false,
                }),
              )
              return
            }

            const progressLines = formatProgressAssistantLines(message)
            const progressTexts = collectProgressAssistantTexts(message)
            for (const text of progressTexts) {
              displayedAssistantTexts.add(text)
            }
            const skipProgressLinesForStreamedText =
              options.stream && assistantMessageHadStreamedText
            assistantTextStreamStarted = false
            assistantMessageHadStreamedText = false
            if (progressLines.length > 0 && !skipProgressLinesForStreamedText) {
              schedulePendingReasoning(progressLines)
            }
          },
          onToolUse(toolUse) {
            activeToolUses.set(toolUse.id, {
              name: toolUse.name,
              input: toolUse.input,
            })

            if (options.verbose) {
              writeEventTextLines([formatToolUseLine(toolUse)])
              return
            }

            flushPendingReasoning()
            markConcreteProgress()
            assistantTextStreamStarted = false
            writeEventTextLines([
              formatProgressToolUseDisplayLine(toolUse),
            ])
          },
          onToolResult(toolResult) {
            clearPendingReasoningTimer()
            pendingReasoningLines = []

            if (options.verbose) {
              markConcreteProgress()
              writeEventTextLines([
                formatVerboseToolResultLine(
                  activeToolUses.get(toolResult.toolUseId),
                  toolResult.output,
                ),
              ])
              return
            }

            markConcreteProgress()
            assistantTextStreamStarted = false
            writeEventTextLines([
              formatProgressToolResultDisplayLine(
                activeToolUses.get(toolResult.toolUseId),
                toolResult.output,
              ),
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
        {
          signal: options.signal,
        },
      )
    } catch (error) {
      clearGenericThinkingTimer()
      clearPendingReasoningTimer()
      flushOutput()
      await persistPartialTurnIfNeeded()
      throw error
    }
    clearGenericThinkingTimer()
    clearPendingReasoningTimer()
    if (!options.verbose) {
      flushPendingReasoning()
    }

    const activeSessionId = options.engine.getSessionId() ?? options.sessionId
    await appendSessionMessages(
      activeSessionId,
      result.appendedMessages,
      options.env,
    )
    const normalizedOutputText = result.outputText.replace(/\s+/g, ' ').trim()
    if (options.stream) {
      if (!outputEndsWithNewline) {
        writeOutput('\n')
      }
    } else if (
      result.outputText.length > 0 &&
      !displayedAssistantTexts.has(normalizedOutputText)
    ) {
      writeEventTextLines(formatProgressAssistantOutputLines(result.outputText))
    }
    flushOutput()
    return {
      sessionId: activeSessionId,
      ...(result.autoCompact ? { autoCompact: result.autoCompact } : {}),
    }
  }

  let result
  try {
    result = await options.engine.submitUserPrompt(options.prompt, {
      signal: options.signal,
    })
  } catch (error) {
      await persistPartialTurnIfNeeded()
      flushOutput()
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
    writeOutput(
      (verboseLines.length > 0 ? verboseLines.join('\n') : result.outputText) +
        '\n',
    )
    flushOutput()
    return {
      sessionId: activeSessionId,
      ...(result.autoCompact ? { autoCompact: result.autoCompact } : {}),
    }
  }

  writeOutput(result.outputText + '\n')
  flushOutput()
  return {
    sessionId: activeSessionId,
    ...(result.autoCompact ? { autoCompact: result.autoCompact } : {}),
  }
}
