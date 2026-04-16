import { appendSessionMessages } from '../session/store.js'
import type { QueryEngine } from '../core/queryEngine.js'
import {
  formatLlmErrorLine,
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

export async function runInteractiveSessionPrompt(
  options: InteractiveSessionPromptOptions,
): Promise<void> {
  const initialMessageCount = options.engine.getMessages().length

  if (options.stream) {
    let outputEndsWithNewline = true
    let activeReasoningKind: 'reasoning' | 'thinking' | null = null
    const streamedReasoningIterations = new Set<number>()
    const writeVerboseTextLines = (verboseLines: string[]): void => {
      if (verboseLines.length === 0) {
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
      process.stdout.write(verboseLines.join('\n') + '\n')
      outputEndsWithNewline = true
    }

    const result = await options.engine.submitUserPromptWithHandlers(
      options.prompt,
      {
        onTextDelta(text) {
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
          if (!options.verbose) {
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
          if (!options.verbose) {
            return
          }

          writeVerboseTextLines([formatToolUseLine(toolUse)])
        },
        onLlmError(error) {
          if (!options.verbose) {
            return
          }

          writeVerboseTextLines([formatLlmErrorLine(error)])
        },
      },
    )

    await appendSessionMessages(
      options.sessionId,
      result.messages.slice(initialMessageCount),
      options.env,
    )
    if (options.verbose) {
      if (!outputEndsWithNewline) {
        process.stdout.write('\n')
      }
    } else if (!result.outputText.endsWith('\n')) {
      process.stdout.write('\n')
    }
    return
  }

  const result = await options.engine.submitUserPrompt(options.prompt)
  await appendSessionMessages(
    options.sessionId,
    result.messages.slice(initialMessageCount),
    options.env,
  )

  if (options.verbose) {
    const verboseLines = formatVerboseLines(
      result.messages.slice(initialMessageCount),
      {
        includeToolCalls: true,
        includeReasoning: true,
        includeContent: true,
      },
    )
    process.stdout.write(
      (verboseLines.length > 0 ? verboseLines.join('\n') : result.outputText) +
        '\n',
    )
    return
  }

  process.stdout.write(result.outputText + '\n')
}
