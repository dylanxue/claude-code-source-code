import { QueryEngine } from '../core/queryEngine.js'
import { createLlmClient } from '../llm/client.js'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import {
  formatClaudeMdLoadOrder,
  loadClaudeMdEntries,
} from '../prompt/claudeMd.js'
import { assemblePromptContext } from '../prompt/contextAssembler.js'
import { buildSystemPrompt } from '../prompt/systemPrompt.js'
import { createDefaultToolRegistry } from '../tools/index.js'
import { askUserQuestionsInteractively } from './askUserQuestions.js'
import type { InteractiveCommand } from './types.js'

export async function runInteractive(command: InteractiveCommand): Promise<void> {
  const runtime = resolveLlmRuntimeConfig(command.options)
  const claudeMdEntries = await loadClaudeMdEntries(command.options.cwd)
  const promptContext = assemblePromptContext({
    cwd: command.options.cwd,
    provider: runtime.provider,
    model: runtime.model,
    mode: 'interactive',
    userSystemPrompt: command.options.systemPrompt,
    claudeMdEntries,
  })

  const toolRegistry = createDefaultToolRegistry()
  const engine = new QueryEngine({
    client: createLlmClient(runtime.provider),
    model: runtime.model,
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

  const lines = [
    'dclaw interactive mode is ready.',
    `cwd: ${command.options.cwd}`,
    `provider: ${runtime.provider}`,
    `provider source: ${runtime.providerSource}`,
    `model: ${runtime.model ?? 'default'}`,
    `model source: ${runtime.modelSource}`,
    `permission mode: ${command.options.permissionMode}`,
    `stream: ${command.options.stream ? 'enabled' : 'disabled'}`,
  ]

  if (command.options.systemPrompt) {
    lines.push('system prompt override: enabled')
  }
  lines.push(`claude.md files loaded: ${claudeMdEntries.length}`)
  lines.push(`tools loaded: ${toolRegistry.list().length}`)
  if (command.options.verbose && claudeMdEntries.length > 0) {
    lines.push(...formatClaudeMdLoadOrder(claudeMdEntries))
  }
  if (command.prompt) {
    lines.push(`initial prompt: ${command.prompt}`)
  } else {
    lines.push('initial prompt: <none>')
  }

  lines.push('')
  if (command.prompt) {
    if (command.options.stream) {
      process.stdout.write(lines.join('\n') + '\n')
      const result = await engine.submitUserPromptWithHandlers(command.prompt, {
        onTextDelta(text) {
          process.stdout.write(text)
        },
      })
      if (!result.outputText.endsWith('\n')) {
        process.stdout.write('\n')
      }
      return
    }

    const result = await engine.submitUserPrompt(command.prompt)
    lines.push('assistant response:')
    lines.push(result.outputText)
  } else {
    lines.push('No prompt provided yet. REPL loop will be added later.')
  }

  process.stdout.write(lines.join('\n') + '\n')
}
