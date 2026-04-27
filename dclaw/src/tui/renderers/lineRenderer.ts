export type LineRendererOptions = {
  writeOutput: (text: string) => void
  flushOutput: () => void
}

export type ReasoningDelta = {
  kind: 'reasoning' | 'thinking'
  text: string
}

export type LineRenderer = ReturnType<typeof createLineRenderer>

export function createLineRenderer(options: LineRendererOptions) {
  let outputEndsWithNewline = true
  let activeReasoningKind: 'reasoning' | 'thinking' | null = null
  let assistantTextStreamStarted = false
  let assistantMessageHadStreamedText = false

  const writeEventTextLines = (lines: string[]): void => {
    if (lines.length === 0) {
      return
    }

    if (activeReasoningKind) {
      options.writeOutput('\n')
      activeReasoningKind = null
      outputEndsWithNewline = true
    }
    if (!outputEndsWithNewline) {
      options.writeOutput('\n')
    }
    options.writeOutput(lines.join('\n') + '\n')
    outputEndsWithNewline = true
  }

  return {
    writeEventTextLines,
    writeAssistantTextDelta(
      text: string,
      options_2: {
        includeAssistantPrefix: boolean
      },
    ) {
      if (text.length === 0) {
        return
      }

      if (activeReasoningKind) {
        options.writeOutput('\n')
        activeReasoningKind = null
        outputEndsWithNewline = true
      }

      if (options_2.includeAssistantPrefix && !assistantTextStreamStarted) {
        if (!outputEndsWithNewline) {
          options.writeOutput('\n')
        }
        options.writeOutput('Assistant: ')
        assistantTextStreamStarted = true
        outputEndsWithNewline = false
      }

      options.writeOutput(text)
      assistantMessageHadStreamedText = true
      outputEndsWithNewline = text.endsWith('\n')
    },
    writeReasoningDelta(prefix: string, delta: ReasoningDelta) {
      if (delta.text.length === 0) {
        return
      }

      if (activeReasoningKind !== delta.kind) {
        if (!outputEndsWithNewline) {
          options.writeOutput('\n')
        }
        options.writeOutput(prefix)
      }
      options.writeOutput(delta.text)
      activeReasoningKind = delta.text.endsWith('\n') ? null : delta.kind
      outputEndsWithNewline = delta.text.endsWith('\n')
    },
    consumeAssistantMessageState(): {
      hadStreamedText: boolean
    } {
      const hadStreamedText = assistantMessageHadStreamedText
      assistantTextStreamStarted = false
      assistantMessageHadStreamedText = false
      return { hadStreamedText }
    },
    resetAssistantStreamState() {
      assistantTextStreamStarted = false
    },
    finishActiveOutput() {
      if (activeReasoningKind || !outputEndsWithNewline) {
        options.writeOutput('\n')
      }
      activeReasoningKind = null
      outputEndsWithNewline = true
      assistantTextStreamStarted = false
      assistantMessageHadStreamedText = false
    },
    flush() {
      options.flushOutput()
    },
  }
}
