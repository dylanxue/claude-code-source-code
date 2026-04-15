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
import type { InteractiveCommand } from './types.js'

export async function runInteractive(command: InteractiveCommand): Promise<void> {
  const claudeMdEntries = await loadClaudeMdEntries(command.options.cwd)
  const promptContext = assemblePromptContext({
    cwd: command.options.cwd,
    provider: command.options.provider,
    model: command.options.model,
    mode: 'interactive',
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

  const lines = [
    'dclaw interactive mode is ready.',
    `cwd: ${command.options.cwd}`,
    `provider: ${command.options.provider}`,
    `model: ${command.options.model ?? 'default'}`,
    `permission mode: ${command.options.permissionMode}`,
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
    const result = await engine.submitUserPrompt(command.prompt)
    lines.push('assistant response:')
    lines.push(result.outputText)
  } else {
    lines.push('No prompt provided yet. REPL loop will be added later.')
  }

  process.stdout.write(lines.join('\n') + '\n')
}
