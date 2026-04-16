import { QueryEngine } from '../core/queryEngine.js'
import { createLlmClient } from '../llm/client.js'
import {
  formatClaudeMdLoadOrder,
  loadClaudeMdEntries,
} from '../prompt/claudeMd.js'
import { assemblePromptContext } from '../prompt/contextAssembler.js'
import { buildSystemPrompt } from '../prompt/systemPrompt.js'
import { createDefaultToolRegistry } from '../tools/index.js'
import { askUserQuestionsInteractively } from './askUserQuestions.js'
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

  const claudeMdEntries = await loadClaudeMdEntries(command.options.cwd)
  const promptContext = assemblePromptContext({
    cwd: command.options.cwd,
    provider: command.options.provider,
    model: command.options.model,
    mode: 'print',
    userSystemPrompt: command.options.systemPrompt,
    claudeMdEntries,
  })

  const toolRegistry = createDefaultToolRegistry()
  const engine = new QueryEngine({
    client: createLlmClient(command.options.provider),
    model: command.options.model,
    systemPrompt: buildSystemPrompt(promptContext),
    toolRegistry,
    toolContext: {
      cwd: command.options.cwd,
      availableTools: toolRegistry.list().map(tool => tool.name),
      permissionMode: command.options.permissionMode,
      readState: new Map(),
      askUserQuestions: askUserQuestionsInteractively,
    },
  })
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

  if (command.options.verbose && claudeMdEntries.length > 0) {
    const debugLines = [...formatClaudeMdLoadOrder(claudeMdEntries), '']
    process.stdout.write(debugLines.join('\n') + '\n')
  }

  if (command.options.outputFormat === 'sse') {
    writeSseEvent('response.complete', {
      outputText: result.outputText,
      iterations: result.messages.length,
    })
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
