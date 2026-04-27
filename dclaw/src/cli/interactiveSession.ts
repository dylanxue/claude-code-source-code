import { appendSessionMessages } from '../session/store.js'
import type { QueryEngine } from '../core/queryEngine.js'
import {
  formatProgressAssistantOutputLines,
  formatVerboseLines,
} from './verboseEvents.js'
import { createLineRenderer } from '../tui/renderers/lineRenderer.js'
import { createTurnPresenter } from '../tui/presenters/turnPresenter.js'
import type { UiEvent } from '../tui/state/index.js'

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
  onUiEvent?: (event: UiEvent) => void
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
    const lineRenderer = createLineRenderer({
      writeOutput,
      flushOutput,
    })
    const turnPresenter = createTurnPresenter({
      stream: options.stream,
      verbose: options.verbose,
      lineRenderer,
      onUiEvent: options.onUiEvent,
    })
    turnPresenter.startTurn(options.prompt)

    let result
    try {
      result = await options.engine.submitUserPromptWithHandlers(
        options.prompt,
        turnPresenter.streamHandlers,
        {
          signal: options.signal,
        },
      )
    } catch (error) {
      turnPresenter.fail()
      await persistPartialTurnIfNeeded()
      throw error
    }

    const activeSessionId = options.engine.getSessionId() ?? options.sessionId
    await appendSessionMessages(
      activeSessionId,
      result.appendedMessages,
      options.env,
    )
    turnPresenter.complete(result.outputText)
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
