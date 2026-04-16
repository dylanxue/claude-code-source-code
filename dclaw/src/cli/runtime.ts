import { QueryEngine } from '../core/queryEngine.js'
import {
  createFileQueryTraceSink,
  createQueryTraceFilePath,
  shouldEnableQueryTrace,
} from '../core/queryTrace.js'
import { createLlmClient } from '../llm/client.js'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import {
  formatClaudeMdLoadOrder,
  loadClaudeMdEntries,
} from '../prompt/claudeMd.js'
import { assemblePromptContext } from '../prompt/contextAssembler.js'
import { buildSystemPrompt } from '../prompt/systemPrompt.js'
import type { PromptMode } from '../prompt/types.js'
import { createDefaultToolRegistry } from '../tools/index.js'
import type { Message } from '../types/message.js'
import { askUserQuestionsInteractively } from './askUserQuestions.js'
import type { CommonCliOptions } from './types.js'

export type PreparedCliRuntime = {
  runtime: ReturnType<typeof resolveLlmRuntimeConfig>
  claudeMdEntries: Awaited<ReturnType<typeof loadClaudeMdEntries>>
  toolRegistry: ReturnType<typeof createDefaultToolRegistry>
  engine: QueryEngine
  queryTracePath?: string
}

export async function prepareCliRuntime(
  options: CommonCliOptions,
  mode: PromptMode,
  initialMessages: Message[] = [],
): Promise<PreparedCliRuntime> {
  const runtime = resolveLlmRuntimeConfig(options)
  const claudeMdEntries = await loadClaudeMdEntries(options.cwd)
  const promptContext = assemblePromptContext({
    cwd: options.cwd,
    provider: runtime.provider,
    model: runtime.model,
    mode,
    userSystemPrompt: options.systemPrompt,
    claudeMdEntries,
  })

  const toolRegistry = createDefaultToolRegistry()
  const queryTraceSink = shouldEnableQueryTrace(options.verbose)
    ? await createFileQueryTraceSink(createQueryTraceFilePath())
    : undefined
  const engine = new QueryEngine({
    client: createLlmClient(runtime.provider),
    model: runtime.model,
    systemPrompt: buildSystemPrompt(promptContext),
    toolRegistry,
    toolContext: {
      cwd: options.cwd,
      availableTools: toolRegistry.list().map(tool => tool.name),
      permissionMode: options.permissionMode,
      readState: new Map(),
      askUserQuestions: askUserQuestionsInteractively,
    },
    initialMessages,
    maxIterations: 8,
    queryTraceSink,
  })

  return {
    runtime,
    claudeMdEntries,
    toolRegistry,
    engine,
    queryTracePath: queryTraceSink?.filePath,
  }
}

export { formatClaudeMdLoadOrder }
