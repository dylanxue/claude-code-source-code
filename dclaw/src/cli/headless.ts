import { appendSessionMessages, createSession } from '../session/store.js'
import { formatAssistantDebugOutput } from './assistantDebugOutput.js'
import { formatClaudeMdLoadOrder, prepareCliRuntime } from './runtime.js'
import type { PrintCommand } from './types.js'

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

  const { runtime, claudeMdEntries, engine, queryTracePath } = await prepareCliRuntime(
    command.options,
    'print',
  )
  const session = await createSession({
    cwd: command.options.cwd,
    mode: 'print',
    provider: runtime.provider,
    model: runtime.model,
  })
  const initialMessageCount = engine.getMessages().length
  let streamedText = ''
  const result = command.options.stream
    ? await engine.submitUserPromptWithHandlers(prompt, {
        onTextDelta(text) {
          streamedText += text
          if (command.options.outputFormat === 'sse') {
            writeSseEvent('assistant.delta', { text })
            return
          }

          process.stdout.write(text)
        },
        onAssistantMessage(message) {
          if (command.options.outputFormat !== 'sse') {
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
        },
        onToolUse(toolUse) {
          if (command.options.outputFormat === 'sse') {
            writeSseEvent('tool.use', toolUse)
          }
        },
        onToolResult(toolResult) {
          if (command.options.outputFormat === 'sse') {
            writeSseEvent('tool.result', toolResult)
          }
        },
      })
    : await engine.submitUserPrompt(prompt)

  await appendSessionMessages(
    session.sessionId,
    result.messages.slice(initialMessageCount),
  )
  const assistantDebugLines = command.options.verbose
    ? formatAssistantDebugOutput(result.messages.slice(initialMessageCount))
    : []

  if (command.options.verbose && (claudeMdEntries.length > 0 || queryTracePath)) {
    const debugLines = [
      ...(queryTracePath ? [`query trace: ${queryTracePath}`] : []),
      ...formatClaudeMdLoadOrder(claudeMdEntries),
      '',
    ]
    process.stdout.write(debugLines.join('\n') + '\n')
  }

  if (command.options.outputFormat === 'sse') {
    writeSseEvent('response.complete', {
      outputText: result.outputText,
      iterations: result.messages.length - initialMessageCount,
      assistantMessage: result.assistantMessage,
    })
    return
  }

  if (!command.options.stream || streamedText.length === 0) {
    process.stdout.write(result.outputText + '\n')
    if (assistantDebugLines.length > 0) {
      process.stdout.write(assistantDebugLines.join('\n') + '\n')
    }
    return
  }

  if (!streamedText.endsWith('\n')) {
    process.stdout.write('\n')
  }
  if (assistantDebugLines.length > 0) {
    process.stdout.write(assistantDebugLines.join('\n') + '\n')
  }
}
