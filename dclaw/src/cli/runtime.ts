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
import { summarizePendingTasks } from '../tasks/planAttachment.js'
import { loadTaskBoardForSession } from '../tasks/store.js'
import { getCurrentTask } from '../tasks/taskState.js'
import { createDefaultToolRegistry } from '../tools/index.js'
import type { Message } from '../types/message.js'
import type { PermissionMode } from '../types/tool.js'
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

export type PreparedCliRuntime = {
  runtime: ReturnType<typeof resolveLlmRuntimeConfig>
  permissionMode: PermissionMode
  permissionModeSource: PermissionModeSource
  dclawMdEntries: Awaited<ReturnType<typeof loadDclawMdEntries>>
  toolRegistry: ReturnType<typeof createDefaultToolRegistry>
  engine: QueryEngine
  rotateQueryTrace: (sessionId?: string) => Promise<string | undefined>
  drainBackgroundWork: (timeoutMs?: number) => Promise<void>
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

  const toolRegistry = createDefaultToolRegistry()
  const queryTraceEnabled = shouldEnableQueryTrace(configured.env)
  const client = createLlmClient(runtime.provider, configured.env)

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
      agentRuntime: {
        client,
        provider: runtime.provider,
        model: runtime.model,
        cwd: options.cwd,
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
      askUserQuestions: askUserQuestionsInteractively,
    },
    initialMessages,
    maxIterations: resolvedMaxIterations.maxIterations,
    sessionMode: mode === 'print' ? 'print' : 'interactive',
  })

  return {
    runtime,
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
