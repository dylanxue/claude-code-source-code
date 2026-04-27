import { appendSessionMessages, createSession } from '../session/store.js'
import { prepareCliRuntime } from './runtime.js'
import type { ExecCommand } from './types.js'
import {
  formatAutoCompactLine,
  formatProgressToolResultLine,
} from './outputFormatting.js'

export async function runHeadless(command: ExecCommand): Promise<void> {
  const prompt = command.prompt?.trim()

  if (!prompt) {
    process.stdout.write('No prompt provided.\n')
    return
  }

  const {
    runtime,
    engine,
    rotateQueryTrace,
    drainBackgroundWork,
  } = await prepareCliRuntime(
    command.options,
    'exec',
  )
  const session = await createSession({
    cwd: command.options.cwd,
    mode: 'exec',
    runtimeName: runtime.runtimeName,
    provider: runtime.provider,
    model: runtime.model,
  })
  engine.setSessionId(session.sessionId)
  await rotateQueryTrace(session.sessionId)
  let streamedText = ''
  let outputEndsWithNewline = true
  const activeToolUses = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >()
  const writeEventLines = (lines: string[]): void => {
    if (lines.length === 0) {
      return
    }

    if (!outputEndsWithNewline) {
      process.stdout.write('\n')
    }
    process.stdout.write(lines.join('\n') + '\n')
    outputEndsWithNewline = true
  }
  const result = command.options.stream
    ? await engine.submitUserPromptWithHandlers(prompt, {
        onTextDelta(text) {
          streamedText += text
          process.stdout.write(text)
          if (text.length > 0) {
            outputEndsWithNewline = text.endsWith('\n')
          }
        },
        onReasoningDelta() {},
        onAssistantMessage() {},
        onToolUse(toolUse) {
          activeToolUses.set(toolUse.id, {
            name: toolUse.name,
            input: toolUse.input,
          })
        },
        onToolResult(toolResult) {
          writeEventLines([
            formatProgressToolResultLine(
              activeToolUses.get(toolResult.toolUseId),
              toolResult.output,
            ),
          ])
        },
        onLlmError() {},
        onCompactDryRun() {},
        onAutoCompact(event) {
          writeEventLines([formatAutoCompactLine(event)])
        },
      })
    : await engine.submitUserPrompt(prompt)

  const activeSessionId = engine.getSessionId() ?? session.sessionId
  await appendSessionMessages(
    activeSessionId,
    result.appendedMessages,
  )

  if (!command.options.stream || streamedText.length === 0) {
    process.stdout.write(result.outputText + '\n')
    await drainBackgroundWork()
    return
  }

  if (!streamedText.endsWith('\n')) {
    process.stdout.write('\n')
  }
  await drainBackgroundWork()
}
