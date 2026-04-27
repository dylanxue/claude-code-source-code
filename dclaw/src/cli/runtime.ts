import { drainAgentRuns } from '../agent/scheduler.js'
import { QueryEngine } from '../core/queryEngine.js'
import {
  createFileQueryTraceSink,
  createQueryTraceFilePath,
  type QueryTraceSink,
  shouldEnableQueryTrace,
} from '../core/queryTrace.js'
import { loadResolvedLlmConfig } from '../llm/config.js'
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
  filterEnabledSkills,
  getSkillStatuses,
  loadDisabledSkillNames,
  setSkillEnabled as persistSkillEnabled,
  type SkillStatus,
} from '../skills/enablement.js'
import {
  createInvokedSkillState,
  restoreInvokedSkillsFromMessages,
} from '../skills/state.js'
import { summarizePendingTasks } from '../tasks/planAttachment.js'
import { loadTaskBoardForSession } from '../tasks/store.js'
import { getCurrentTask } from '../tasks/taskState.js'
import { createDefaultToolRegistry } from '../tools/index.js'
import type { Message } from '../types/message.js'
import type { PermissionMode } from '../types/tool.js'
import { appendSessionMessages } from '../session/store.js'
import { getDclawHomeDir } from '../session/paths.js'
import { askUserQuestionsInteractively } from './askUserQuestions.js'
import { buildConfigAwareEnvWithSources } from './configFile.js'
import {
  resolvePermissionMode,
  type PermissionModeSource,
} from './permissionModeConfig.js'
import { resolveMaxIterations } from './maxIterationsConfig.js'
import type { CommonCliOptions } from './types.js'
import { join } from 'node:path'

export type PreparedCliRuntime = {
  runtime: ReturnType<typeof resolveLlmRuntimeConfig>
  permissionMode: PermissionMode
  permissionModeSource: PermissionModeSource
  dclawMdEntries: Awaited<ReturnType<typeof loadDclawMdEntries>>
  toolRegistry: ReturnType<typeof createDefaultToolRegistry>
  engine: QueryEngine
  rotateQueryTrace: (sessionId?: string) => Promise<string | undefined>
  drainBackgroundWork: (timeoutMs?: number) => Promise<void>
  listSkillStatuses: () => Promise<SkillStatus[]>
  setSkillEnabled: (skillName: string, enabled: boolean) => Promise<SkillStatus[]>
}

export async function prepareCliRuntime(
  options: CommonCliOptions,
  mode: PromptMode,
  initialMessages: Message[] = [],
): Promise<PreparedCliRuntime> {
  const configured = await buildConfigAwareEnvWithSources(options.cwd)
  const llmConfig = await loadResolvedLlmConfig(options.cwd, configured.env)
  const runtime = resolveLlmRuntimeConfig(options, llmConfig, configured.env)
  const resolvedPermissionMode = await resolvePermissionMode(options, configured.env)
  const resolvedMaxIterations = await resolveMaxIterations(
    options,
    configured.env,
    key => configured.keySources[key],
  )
  const dclawMdEntries = await loadDclawMdEntries(options.cwd)
  const promptEnvironment = await loadPromptEnvironmentContext(options.cwd)
  const loadAllSkills = () => loadSkills({
    cwd: options.cwd,
    env: configured.env,
  })
  const buildSkillRegistry = async () => {
    const [skills, disabledSkillNames] = await Promise.all([
      loadAllSkills(),
      loadDisabledSkillNames(configured.env),
    ])
    return createSkillRegistry(filterEnabledSkills(skills, disabledSkillNames))
  }
  let skillRegistry = await buildSkillRegistry()
  const invokedSkills = createInvokedSkillState()
  restoreInvokedSkillsFromMessages(initialMessages, invokedSkills)

  const toolRegistry = createDefaultToolRegistry()
  const queryTraceEnabled = shouldEnableQueryTrace(configured.env)
  const client = runtime.primary.client
  const reloadSkills = async () => {
    skillRegistry = await buildSkillRegistry()

    toolContext.skillRegistry = skillRegistry
    if (toolContext.agentRuntime) {
      toolContext.agentRuntime.skillRegistry = skillRegistry
    }

    return {
      reloaded: true,
      totalSkills: skillRegistry.list().length,
      skillNames: skillRegistry
        .list()
        .map(skill => skill.name)
        .sort((left, right) => left.localeCompare(right)),
    }
  }

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
        model: state.model ?? runtime.primary.model,
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
      provider: runtime.primary.provider,
      model: state.model ?? runtime.primary.model,
      mode,
      skillsRuntime: {
        userSkillsDir: join(getDclawHomeDir(configured.env), 'skills'),
        projectSkillsDir: join(options.cwd, '.dclaw', 'skills'),
      },
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
    model: runtime.primary.model,
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

  const toolContext = {
    cwd: options.cwd,
    availableTools: toolRegistry.list().map(tool => tool.name),
    permissionMode: resolvedPermissionMode.permissionMode,
    planFilePath: undefined,
    readState: new Map(),
    skillRegistry,
    invokedSkills,
    runtimeProfile: runtime,
    reloadSkills,
    agentRuntime: {
      client,
      provider: runtime.primary.provider,
      model: runtime.primary.model,
      cwd: options.cwd,
      runtimeProfile: runtime,
      permissionMode: resolvedPermissionMode.permissionMode,
      availableTools: toolRegistry.list().map(tool => tool.name),
      planFilePath: undefined,
      toolRegistry,
      skillRegistry,
      reloadSkills,
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
  }

  engine = new QueryEngine({
    client,
    provider: runtime.primary.provider,
    modelLimitsEnv: configured.env,
    modelCatalogOverrides: llmConfig.modelCatalogOverrides,
    model: runtime.primary.model,
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
    toolContext,
    initialMessages,
    maxIterations: resolvedMaxIterations.maxIterations,
    sessionMode: mode === 'exec' ? 'exec' : 'interactive',
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
    listSkillStatuses: async () => {
      const [skills, disabledSkillNames] = await Promise.all([
        loadAllSkills(),
        loadDisabledSkillNames(configured.env),
      ])
      return getSkillStatuses(skills, disabledSkillNames)
    },
    setSkillEnabled: async (skillName: string, enabled: boolean) => {
      await persistSkillEnabled(skillName, enabled, configured.env)
      skillRegistry = await buildSkillRegistry()
      engine.setSkillRegistry(skillRegistry)
      return getSkillStatuses(
        await loadAllSkills(),
        await loadDisabledSkillNames(configured.env),
      )
    },
  }
}

export { formatDclawMdLoadOrder }
