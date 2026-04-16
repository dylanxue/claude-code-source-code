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
import type { PermissionMode } from '../types/tool.js'
import { askUserQuestionsInteractively } from './askUserQuestions.js'
import { buildConfigAwareEnvWithSources } from './configFile.js'
import {
  resolvePermissionMode,
  type PermissionModeSource,
} from './permissionModeConfig.js'
import type { CommonCliOptions } from './types.js'

export type PreparedCliRuntime = {
  runtime: ReturnType<typeof resolveLlmRuntimeConfig>
  permissionMode: PermissionMode
  permissionModeSource: PermissionModeSource
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
  const configured = await buildConfigAwareEnvWithSources(options.cwd)
  const runtime = resolveLlmRuntimeConfig(
    options,
    configured.env,
    key => configured.keySources[key],
  )
  const resolvedPermissionMode = await resolvePermissionMode(options, configured.env)
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
  const queryTraceSink = shouldEnableQueryTrace(configured.env)
    ? await createFileQueryTraceSink(createQueryTraceFilePath(configured.env))
    : undefined
  const engine = new QueryEngine({
    client: createLlmClient(runtime.provider, configured.env),
    provider: runtime.provider,
    modelLimitsEnv: configured.env,
    model: runtime.model,
    systemPrompt: buildSystemPrompt(promptContext),
    toolRegistry,
    toolContext: {
      cwd: options.cwd,
      availableTools: toolRegistry.list().map(tool => tool.name),
      permissionMode: resolvedPermissionMode.permissionMode,
      readState: new Map(),
      askUserQuestions: askUserQuestionsInteractively,
    },
    initialMessages,
    maxIterations: 8,
    queryTraceSink,
  })

  return {
    runtime,
    permissionMode: resolvedPermissionMode.permissionMode,
    permissionModeSource: resolvedPermissionMode.permissionModeSource,
    claudeMdEntries,
    toolRegistry,
    engine,
    queryTracePath: queryTraceSink?.filePath,
  }
}

export { formatClaudeMdLoadOrder }
