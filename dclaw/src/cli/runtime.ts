import { drainAgentRuns } from '../agent/scheduler.js'
import { QueryEngine } from '../core/queryEngine.js'
import {
  createFileQueryTraceSink,
  createQueryTraceFilePath,
  type QueryTraceSink,
  shouldEnableQueryTrace,
} from '../core/queryTrace.js'
import { createLlmClient } from '../llm/client.js'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import {
  formatDclawMdLoadOrder,
  loadDclawMdEntries,
} from '../prompt/dclawMd.js'
import { loadPromptEnvironmentContext } from '../prompt/environment.js'
import { loadPromptMemoryContext } from '../memory/prompt.js'
import { createAutomaticMemoryExtractor } from '../memory/extract.js'
import { assemblePromptContext } from '../prompt/contextAssembler.js'
import { buildSystemPrompt } from '../prompt/systemPrompt.js'
import type { PromptMode } from '../prompt/types.js'
import { createSkillRegistry } from '../skills/registry.js'
import { loadSkills } from '../skills/loader.js'
import {
  createInvokedSkillState,
  restoreInvokedSkillsFromMessages,
} from '../skills/state.js'
import { summarizePendingTasks } from '../tasks/planAttachment.js'
import { loadTaskBoardForSession } from '../tasks/store.js'
import { getCurrentTask } from '../tasks/taskState.js'
import { createDefaultToolRegistry } from '../tools/index.js'
import type { Message } from '../types/message.js'
import type {
  PermissionMode,
  VisionRuntime,
} from '../types/tool.js'
import { appendSessionMessages } from '../session/store.js'
import { askUserQuestionsInteractively } from './askUserQuestions.js'
import { buildConfigAwareEnvWithSources } from './configFile.js'
import {
  resolvePermissionMode,
  type PermissionModeSource,
} from './permissionModeConfig.js'
import {
  resolveMaxIterations,
} from './maxIterationsConfig.js'
import type { CommonCliOptions } from './types.js'
import type { LlmProviderName } from '../llm/providerNames.js'
import { resolveModelCapabilities } from '../llm/modelLimits.js'

export type PreparedCliRuntime = {
  runtime: ReturnType<typeof resolveLlmRuntimeConfig>
  supportsVisionInput: boolean
  visionRuntime?: VisionRuntime
  permissionMode: PermissionMode
  permissionModeSource: PermissionModeSource
  dclawMdEntries: Awaited<ReturnType<typeof loadDclawMdEntries>>
  toolRegistry: ReturnType<typeof createDefaultToolRegistry>
  engine: QueryEngine
  rotateQueryTrace: (sessionId?: string) => Promise<string | undefined>
  drainBackgroundWork: (timeoutMs?: number) => Promise<void>
}

function normalizeProviderName(
  value: string | undefined,
): LlmProviderName | undefined {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'anthropic':
    case 'anthropic-compatible':
      return 'anthropic'
    case 'openai':
    case 'openai-compatible':
      return 'openai'
    case 'stub':
      return 'stub'
    default:
      return undefined
  }
}

function resolveVisionRuntime(
  env: NodeJS.ProcessEnv,
): VisionRuntime | undefined {
  const provider = normalizeProviderName(
    env.DCLAW_VISION_PROVIDER ?? env.VISION_PROVIDER,
  )
  if (!provider) {
    return undefined
  }

  const model =
    env.DCLAW_VISION_MODEL?.trim() ||
    env.VISION_MODEL?.trim() ||
    undefined

  return {
    client: createLlmClient(provider, env),
    provider,
    model,
  }
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
  const resolvedMaxIterations = await resolveMaxIterations(
    options,
    configured.env,
    key => configured.keySources[key],
  )
  const dclawMdEntries = await loadDclawMdEntries(options.cwd)
  const promptEnvironment = await loadPromptEnvironmentContext(options.cwd)
  const skillRegistry = createSkillRegistry(
    await loadSkills({
      cwd: options.cwd,
    }),
  )
  const invokedSkills = createInvokedSkillState()
  restoreInvokedSkillsFromMessages(initialMessages, invokedSkills)

  const toolRegistry = createDefaultToolRegistry()
  const queryTraceEnabled = shouldEnableQueryTrace(configured.env)
  const client = createLlmClient(runtime.provider, configured.env)
  const supportsVisionInput = resolveModelCapabilities(
    runtime.provider,
    runtime.model,
    configured.env,
  ).supportsVisionInput
  const visionRuntime = resolveVisionRuntime(configured.env)

  const resolveSystemPromptForUserPrompt = async (state: {
    sessionId?: string
    permissionMode: PermissionMode
    model?: string
    userPrompt: string
    queryTraceSink?: QueryTraceSink
  }): Promise<string> => {
    const board =
      state.sessionId
        ? await loadTaskBoardForSession(state.sessionId, configured.env)
        : null
    const currentTask = board ? getCurrentTask(board) : undefined
    const memory = await loadPromptMemoryContext(
      options.cwd,
      state.userPrompt,
      configured.env,
      {
        client,
        model: state.model ?? runtime.model,
        queryTraceSink: state.queryTraceSink,
      },
    )
    state.queryTraceSink?.record({
      event: 'memory.recall',
      data: {
        selectionMode: 'side_query',
        memoryDir: memory.memoryDir,
        manifestCount: memory.manifestCount,
        recalledCount: memory.recalledEntries.length,
        recalledPaths: memory.recalledEntries.map(entry => entry.path),
      },
    })
    const promptContext = assemblePromptContext({
      cwd: options.cwd,
      provider: runtime.provider,
      model: state.model ?? runtime.model,
      mode,
      permissionMode: state.permissionMode,
      currentDate: promptEnvironment.currentDate,
      environment: {
        platform: promptEnvironment.platform,
        shell: promptEnvironment.shell,
        osVersion: promptEnvironment.osVersion,
        isGitRepository: promptEnvironment.isGitRepository,
      },
      gitStatus: promptEnvironment.gitStatus,
      plan: board
        ? {
            boardId: board.boardId,
            status: board.mode,
            planFilePath: board.planFilePath,
            boardTitle: board.title,
            boardPurpose: board.purpose,
            boardBackground: board.background,
            boardPlan: board.plan,
            boardScope: board.scope,
            boardVerification: board.verification,
            currentTaskTitle: currentTask?.subject,
            currentStep: board.currentStep,
            taskSummary: summarizePendingTasks(board),
          }
        : undefined,
      memory,
      userSystemPrompt: options.systemPrompt,
    })
    return buildSystemPrompt(promptContext)
  }

  const memoryExtractor = createAutomaticMemoryExtractor({
    client,
    model: runtime.model,
    workspaceRoot: options.cwd,
    env: configured.env,
  })
  let engine!: QueryEngine
  const appendBackgroundMessages = async (
    sessionId: string | undefined,
    messages: Message[],
  ): Promise<void> => {
    if (messages.length === 0) {
      return
    }

    engine.appendMessages(messages)
    if (!sessionId) {
      return
    }

    await appendSessionMessages(
      sessionId,
      messages,
      configured.env,
    ).catch(() => undefined)
  }

  engine = new QueryEngine({
    client,
    provider: runtime.provider,
    modelLimitsEnv: configured.env,
    model: runtime.model,
    systemPromptResolver: resolveSystemPromptForUserPrompt,
    turnCompleteHook: async state => {
      memoryExtractor.scheduleExtractTurn({
        state: {
          userPrompt: state.userPrompt,
          messages: state.messages,
          queryTraceSink: state.queryTraceSink,
          resolveSystemPrompt: () =>
            resolveSystemPromptForUserPrompt({
              sessionId: state.sessionId,
              permissionMode: state.permissionMode,
              model: state.model,
              userPrompt: state.userPrompt,
              queryTraceSink: state.queryTraceSink,
            }),
        },
        onMessages: async messages =>
          appendBackgroundMessages(state.sessionId, messages),
      })
      return []
    },
    dclawMdEntries,
    toolRegistry,
    toolContext: {
      cwd: options.cwd,
      availableTools: toolRegistry.list().map(tool => tool.name),
      permissionMode: resolvedPermissionMode.permissionMode,
      planFilePath: undefined,
      readState: new Map(),
      skillRegistry,
      invokedSkills,
      agentRuntime: {
        client,
        provider: runtime.provider,
        model: runtime.model,
        cwd: options.cwd,
        supportsVisionInput,
        visionRuntime,
        permissionMode: resolvedPermissionMode.permissionMode,
        availableTools: toolRegistry.list().map(tool => tool.name),
        planFilePath: undefined,
        toolRegistry,
        skillRegistry,
        modelLimitsEnv: configured.env,
        systemPromptResolver: resolveSystemPromptForUserPrompt,
        dclawMdEntries,
        env: configured.env,
        createQueryTraceSink: async (sessionId: string, tracePath?: string) => {
          if (!queryTraceEnabled) {
            return undefined
          }

          return createFileQueryTraceSink(
            tracePath ?? createQueryTraceFilePath(configured.env, sessionId),
            sessionId,
          )
        },
      },
      supportsVisionInput,
      visionRuntime,
      askUserQuestions: askUserQuestionsInteractively,
    },
    initialMessages,
    maxIterations: resolvedMaxIterations.maxIterations,
    sessionMode: mode === 'print' ? 'print' : 'interactive',
  })

  return {
    runtime,
    supportsVisionInput,
    visionRuntime,
    permissionMode: resolvedPermissionMode.permissionMode,
    permissionModeSource: resolvedPermissionMode.permissionModeSource,
    dclawMdEntries,
    toolRegistry,
    engine,
    rotateQueryTrace: async (sessionId?: string) => {
      if (!queryTraceEnabled || !sessionId) {
        engine.setQueryTraceSink(undefined)
        return undefined
      }

      const queryTraceSink = await createFileQueryTraceSink(
        createQueryTraceFilePath(configured.env, sessionId),
        sessionId,
      )
      engine.setQueryTraceSink(queryTraceSink)
      return queryTraceSink.filePath
    },
    drainBackgroundWork: async (timeoutMs?: number) => {
      await memoryExtractor.drainPendingExtraction(timeoutMs)
      await drainAgentRuns(timeoutMs)
    },
  }
}

export { formatDclawMdLoadOrder }
