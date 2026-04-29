import type { QueryStreamHandlers } from '../../core/queryEngine.js'
import {
  collectProgressAssistantTexts,
  formatAutoCompactLine,
  formatProgressAssistantLines,
  formatProgressAssistantOutputLines,
  formatProgressThinkingLine,
  formatReasoningDeltaPrefix,
  formatProgressToolResultDisplayLine,
  formatProgressToolResultLine,
  formatProgressToolUseDisplayLine,
  formatProgressToolUseLine,
} from '../../cli/outputFormatting.js'
import type { LineRenderer } from '../renderers/lineRenderer.js'
import type { UiEvent } from '../state/types.js'
import { getActivityGroupTitle } from './activityPresenter.js'
import { presentPlanModeSnapshot } from './planSnapshotPresenter.js'
import { presentTaskBoardSnapshot } from './taskSnapshotPresenter.js'

type PendingAssistantProgress = {
  lines: string[]
  texts: string[]
}

export type TurnPresenterOptions = {
  stream: boolean
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
  const normalizeAssistantText = (text: string): string =>
    text.replace(/\s+/gu, ' ').trim()

  const activeToolUses = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >()
  const displayedAssistantTexts = new Set<string>()
  let pendingAssistantProgress: PendingAssistantProgress | undefined
  let genericThinkingTimer: ReturnType<typeof setTimeout> | undefined
  let pendingReasoningTimer: ReturnType<typeof setTimeout> | undefined
  let pendingReasoningDeltaText = ''
  let pendingReasoningDeltaKind: 'reasoning' | 'thinking' | null = null
  let hasConcreteProgress = false
  let activePrompt = ''

  const emit = (event: UiEvent): void => {
    options.onUiEvent?.(event)
  }

  const rememberDisplayedAssistantTexts = (texts: string[]): void => {
    for (const text of texts) {
      const normalized = normalizeAssistantText(text)
      if (normalized.length > 0) {
        displayedAssistantTexts.add(normalized)
      }
    }
  }

  const emitAssistantProgressMessage = (text: string): void => {
    const renderedText = text.trimEnd()
    const normalized = normalizeAssistantText(renderedText)
    if (normalized.length === 0 || displayedAssistantTexts.has(normalized)) {
      return
    }

    displayedAssistantTexts.add(normalized)
    emit({
      type: 'assistant_progress_message',
      text: renderedText,
    })
  }

  const clearPendingReasoningDelta = (): void => {
    pendingReasoningDeltaText = ''
    pendingReasoningDeltaKind = null
  }

  const flushPendingReasoningDelta = (): void => {
    if (pendingReasoningDeltaText.length === 0) {
      return
    }

    emitAssistantProgressMessage(pendingReasoningDeltaText)
    clearPendingReasoningDelta()
  }

  const flushCompletedReasoningDeltaLines = (): void => {
    const lastLineBreakIndex = pendingReasoningDeltaText.lastIndexOf('\n')
    if (lastLineBreakIndex === -1) {
      return
    }

    const stableText = pendingReasoningDeltaText.slice(0, lastLineBreakIndex + 1)
    pendingReasoningDeltaText = pendingReasoningDeltaText.slice(lastLineBreakIndex + 1)
    emitAssistantProgressMessage(stableText)
    if (pendingReasoningDeltaText.length === 0) {
      pendingReasoningDeltaKind = null
    }
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

  const getUndisplayedProgress = (
    texts: string[],
    lines: string[],
  ): PendingAssistantProgress => {
    const nextTexts: string[] = []
    const nextLines: string[] = []

    for (let index = 0; index < Math.min(texts.length, lines.length); index += 1) {
      const text = texts[index]
      const line = lines[index]
      if (!text || !line) {
        continue
      }

      if (displayedAssistantTexts.has(normalizeAssistantText(text))) {
        continue
      }

      nextTexts.push(text)
      nextLines.push(line)
    }

    return {
      lines: nextLines,
      texts: nextTexts,
    }
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
    if (hasConcreteProgress || genericThinkingTimer) {
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
    clearPendingReasoningDelta()
    clearGenericThinkingTimer()
    clearPendingReasoningTimer()
    displayedAssistantTexts.clear()
    activeToolUses.clear()

    emit({
      type: 'turn_started',
      prompt,
      promptKind: prompt.trimStart().startsWith('/') ? 'slash' : 'prompt',
    })

    scheduleGenericThinking()
  }

  const streamHandlers: QueryStreamHandlers = {
    onTextDelta(text) {
      if (!options.stream) {
        return
      }

      flushPendingReasoningDelta()
      options.lineRenderer.writeAssistantTextDelta(text, {
        includeAssistantPrefix: true,
      })
      emit({
        type: 'assistant_text_delta',
        text,
      })
    },
    onReasoningDelta(delta) {
      if (!options.stream) {
        return
      }

      hasConcreteProgress = true
      clearGenericThinkingTimer()
      if (
        pendingReasoningDeltaKind !== null &&
        pendingReasoningDeltaKind !== delta.kind
      ) {
        flushPendingReasoningDelta()
      }
      pendingReasoningDeltaKind = delta.kind
      pendingReasoningDeltaText += delta.text
      options.lineRenderer.writeReasoningDelta(
        formatReasoningDeltaPrefix(delta.kind),
        delta,
      )
      flushCompletedReasoningDeltaLines()
    },
    onAssistantMessage(message) {
      flushPendingReasoningDelta()
      const progressLines = formatProgressAssistantLines(message)
      const progressTexts = collectProgressAssistantTexts(message)
      const progressToSchedule = getUndisplayedProgress(
        progressTexts,
        progressLines,
      )
      rememberDisplayedAssistantTexts(progressTexts)
      const { hadStreamedText } =
        options.lineRenderer.consumeAssistantMessageState()
      const skipProgressLinesForStreamedText = options.stream && hadStreamedText
      if (
        progressToSchedule.lines.length > 0 &&
        !skipProgressLinesForStreamedText
      ) {
        schedulePendingReasoning(
          progressToSchedule.texts,
          progressToSchedule.lines,
        )
      }
    },
    onToolUse(toolUse) {
      activeToolUses.set(toolUse.id, {
        name: toolUse.name,
        input: toolUse.input,
      })
      flushPendingReasoningDelta()
      flushPendingReasoning()
      markConcreteProgress()
      options.lineRenderer.resetAssistantStreamState()
      options.lineRenderer.writeEventTextLines([
        formatProgressToolUseDisplayLine(toolUse),
      ])

      emit({
        type: 'tool_use_started',
        toolUseId: toolUse.id,
        text: formatProgressToolUseLine(toolUse),
        title: getActivityGroupTitle(toolUse.name, toolUse.input),
        toolName: toolUse.name,
        input: toolUse.input,
      })
    },
    onToolResult(toolResult) {
      clearPendingReasoningTimer()
      clearPendingAssistantProgress()
      markConcreteProgress()
      options.lineRenderer.resetAssistantStreamState()
      options.lineRenderer.writeEventTextLines([
        formatProgressToolResultDisplayLine(
          activeToolUses.get(toolResult.toolUseId),
          toolResult.output,
        ),
      ])

      emit({
        type: 'tool_result_received',
        toolUseId: toolResult.toolUseId,
        text: formatProgressToolResultLine(
          activeToolUses.get(toolResult.toolUseId),
          toolResult.output,
        ),
        output: toolResult.output,
      })

      if (toolResult.taskBoard) {
        emit({
          type: 'task_board_updated',
          snapshot: presentTaskBoardSnapshot(toolResult.taskBoard),
        })
      }
      if (toolResult.planMode && toolResult.sessionId) {
        emit({
          type: 'plan_mode_updated',
          snapshot: presentPlanModeSnapshot(
            toolResult.sessionId,
            toolResult.planMode,
          ),
        })
      }
    },
    onLlmError() {},
    onCompactDryRun() {},
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
    flushPendingReasoningDelta()
    flushPendingReasoning()

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
    flushPendingReasoningDelta()
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
