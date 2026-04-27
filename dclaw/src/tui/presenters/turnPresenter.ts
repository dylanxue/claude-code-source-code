import type { QueryStreamHandlers } from '../../core/queryEngine.js'
import {
  collectProgressAssistantTexts,
  formatAutoCompactLine,
  formatCompactDryRunLine,
  formatLlmErrorLine,
  formatProgressAssistantLines,
  formatProgressAssistantOutputLines,
  formatProgressThinkingLine,
  formatProgressToolResultDisplayLine,
  formatProgressToolResultLine,
  formatProgressToolUseDisplayLine,
  formatProgressToolUseLine,
  formatReasoningDeltaPrefix,
  formatToolUseLine,
  formatVerboseMessageLines,
  formatVerboseToolResultLine,
} from '../../cli/verboseEvents.js'
import type { LineRenderer } from '../renderers/lineRenderer.js'
import type { UiEvent } from '../state/types.js'
import { getActivityGroupTitle } from './activityPresenter.js'

type PendingAssistantProgress = {
  lines: string[]
  texts: string[]
}

export type TurnPresenterOptions = {
  stream: boolean
  verbose: boolean
  lineRenderer: LineRenderer
  onUiEvent?: (event: UiEvent) => void
}

export type TurnPresenter = {
  startTurn: (prompt: string) => void
  streamHandlers: QueryStreamHandlers
  complete: (outputText: string) => void
  fail: () => void
}

export function createTurnPresenter(
  options: TurnPresenterOptions,
): TurnPresenter {
  const activeToolUses = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >()
  const displayedAssistantTexts = new Set<string>()
  const streamedReasoningIterations = new Set<number>()
  let pendingAssistantProgress: PendingAssistantProgress | undefined
  let genericThinkingTimer: ReturnType<typeof setTimeout> | undefined
  let pendingReasoningTimer: ReturnType<typeof setTimeout> | undefined
  let hasConcreteProgress = false
  let activePrompt = ''

  const emit = (event: UiEvent): void => {
    options.onUiEvent?.(event)
  }

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

  const clearPendingAssistantProgress = (): void => {
    pendingAssistantProgress = undefined
  }

  const markConcreteProgress = (): void => {
    hasConcreteProgress = true
    clearGenericThinkingTimer()
    clearPendingReasoningTimer()
    clearPendingAssistantProgress()
  }

  const flushPendingReasoning = (): void => {
    if (!pendingAssistantProgress) {
      return
    }

    options.lineRenderer.writeEventTextLines(pendingAssistantProgress.lines)
    for (const text of pendingAssistantProgress.texts) {
      emit({
        type: 'assistant_progress_message',
        text,
      })
    }
    clearPendingAssistantProgress()
    pendingReasoningTimer = undefined
    hasConcreteProgress = true
  }

  const schedulePendingReasoning = (texts: string[], lines: string[]): void => {
    if (lines.length === 0) {
      return
    }

    pendingAssistantProgress = {
      lines,
      texts,
    }
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
        const text = formatProgressThinkingLine()
        options.lineRenderer.writeEventTextLines([`Assistant: ${text}`])
        emit({
          type: 'assistant_progress_message',
          text,
        })
      }
    }, 250)
    genericThinkingTimer.unref?.()
  }

  const startTurn = (prompt: string): void => {
    activePrompt = prompt
    hasConcreteProgress = false
    clearPendingAssistantProgress()
    clearGenericThinkingTimer()
    clearPendingReasoningTimer()
    displayedAssistantTexts.clear()
    streamedReasoningIterations.clear()
    activeToolUses.clear()

    emit({
      type: 'turn_started',
      prompt,
      promptKind: prompt.trimStart().startsWith('/') ? 'slash' : 'prompt',
    })

    if (!options.verbose) {
      scheduleGenericThinking()
    }
  }

  const streamHandlers: QueryStreamHandlers = {
    onTextDelta(text) {
      if (!options.stream) {
        return
      }

      options.lineRenderer.writeAssistantTextDelta(text, {
        includeAssistantPrefix: !options.verbose,
      })
      emit({
        type: 'assistant_text_delta',
        text,
      })
    },
    onReasoningDelta(delta) {
      if (!options.verbose || delta.text.length === 0) {
        return
      }

      streamedReasoningIterations.add(delta.iteration)
      options.lineRenderer.writeReasoningDelta(
        formatReasoningDeltaPrefix(delta.kind),
        delta,
      )
    },
    onAssistantMessage(message) {
      if (options.verbose) {
        if (streamedReasoningIterations.has(message.iteration)) {
          return
        }

        markConcreteProgress()
        const lines = formatVerboseMessageLines(message, {
          includeToolCalls: false,
          includeReasoning: true,
          includeContent: false,
        })
        options.lineRenderer.writeEventTextLines(lines)
        for (const text of collectProgressAssistantTexts(message)) {
          emit({
            type: 'assistant_progress_message',
            text,
          })
        }
        return
      }

      const progressLines = formatProgressAssistantLines(message)
      const progressTexts = collectProgressAssistantTexts(message)
      for (const text of progressTexts) {
        displayedAssistantTexts.add(text)
      }
      const { hadStreamedText } =
        options.lineRenderer.consumeAssistantMessageState()
      const skipProgressLinesForStreamedText = options.stream && hadStreamedText
      if (progressLines.length > 0 && !skipProgressLinesForStreamedText) {
        schedulePendingReasoning(progressTexts, progressLines)
      }
    },
    onToolUse(toolUse) {
      activeToolUses.set(toolUse.id, {
        name: toolUse.name,
        input: toolUse.input,
      })

      if (options.verbose) {
        options.lineRenderer.writeEventTextLines([formatToolUseLine(toolUse)])
      } else {
        flushPendingReasoning()
        markConcreteProgress()
        options.lineRenderer.resetAssistantStreamState()
        options.lineRenderer.writeEventTextLines([
          formatProgressToolUseDisplayLine(toolUse),
        ])
      }

      emit({
        type: 'tool_use_started',
        toolUseId: toolUse.id,
        text: formatProgressToolUseLine(toolUse),
        title: getActivityGroupTitle(toolUse.name),
      })
    },
    onToolResult(toolResult) {
      clearPendingReasoningTimer()
      clearPendingAssistantProgress()

      if (options.verbose) {
        markConcreteProgress()
        options.lineRenderer.writeEventTextLines([
          formatVerboseToolResultLine(
            activeToolUses.get(toolResult.toolUseId),
            toolResult.output,
          ),
        ])
      } else {
        markConcreteProgress()
        options.lineRenderer.resetAssistantStreamState()
        options.lineRenderer.writeEventTextLines([
          formatProgressToolResultDisplayLine(
            activeToolUses.get(toolResult.toolUseId),
            toolResult.output,
          ),
        ])
      }

      emit({
        type: 'tool_result_received',
        toolUseId: toolResult.toolUseId,
        text: formatProgressToolResultLine(
          activeToolUses.get(toolResult.toolUseId),
          toolResult.output,
        ),
      })
    },
    onLlmError(error) {
      if (!options.verbose) {
        return
      }

      const line = formatLlmErrorLine(error)
      options.lineRenderer.writeEventTextLines([line])
      emit({
        type: 'system_notice',
        text: line,
      })
    },
    onCompactDryRun(event) {
      if (!options.verbose) {
        return
      }

      const line = formatCompactDryRunLine(event)
      options.lineRenderer.writeEventTextLines([line])
      emit({
        type: 'system_notice',
        text: line,
      })
    },
    onAutoCompact(event) {
      const line = formatAutoCompactLine(event)
      options.lineRenderer.writeEventTextLines([line])
      emit({
        type: 'system_notice',
        text: line,
      })
    },
  }

  const complete = (outputText: string): void => {
    clearGenericThinkingTimer()
    clearPendingReasoningTimer()
    if (!options.verbose) {
      flushPendingReasoning()
    }

    const normalizedOutputText = outputText.replace(/\s+/g, ' ').trim()
    if (options.stream) {
      options.lineRenderer.finishActiveOutput()
    } else if (
      outputText.length > 0 &&
      !displayedAssistantTexts.has(normalizedOutputText)
    ) {
      options.lineRenderer.writeEventTextLines(
        formatProgressAssistantOutputLines(outputText),
      )
    }

    emit({
      type: 'turn_completed',
      outputText,
    })
    options.lineRenderer.flush()
  }

  const fail = (): void => {
    clearGenericThinkingTimer()
    clearPendingReasoningTimer()
    clearPendingAssistantProgress()
    options.lineRenderer.flush()
    if (activePrompt) {
      emit({
        type: 'turn_interrupted',
        prompt: activePrompt,
      })
    }
  }

  return {
    startTurn,
    streamHandlers,
    complete,
    fail,
  }
}
