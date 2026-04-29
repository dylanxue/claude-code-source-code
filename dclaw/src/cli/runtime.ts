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
import {
  loadPromptMemoryContext,
  MAX_SURFACED_MEMORY_SESSION_BYTES,
} from '../memory/prompt.js'
import { createAutomaticMemoryExtractor } from '../memory/extract.js'
import { getMemoryDir } from '../memory/paths.js'
import { createRelevantMemoryReminderMessage } from '../memory/reminder.js'
import { createSessionMemoryUpdater } from '../sessionMemory/sessionMemory.js'
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
import { loadSessionMeta } from '../session/store.js'
import { createDefaultToolRegistry } from '../tools/index.js'
import type { Message } from '../types/message.js'
import type { PermissionMode } from '../types/tool.js'
import type {
  RelevantMemoryPrefetchHandle,
  RelevantMemoryPrefetchResult,
  RelevantMemoryRecentTool,
} from '../core/relevantMemoryPrefetch.js'
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
  env: NodeJS.ProcessEnv
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
  const surfacedMemoryPaths = new Set<string>()
  let surfacedMemoryBytes = 0

  const getReadMemoryPaths = () => {
    const memoryDir = getMemoryDir(options.cwd, configured.env)
    return new Set(
      [...toolContext.readState.keys()].filter(path =>
        path === memoryDir || path.startsWith(`${memoryDir}/`),
      ),
    )
  }

  const getExcludedMemoryPaths = () =>
    new Set([
      ...surfacedMemoryPaths,
      ...getReadMemoryPaths(),
    ])

  const formatRecentMemoryTool = (tool: RelevantMemoryRecentTool): string =>
    [
      `${tool.name}: ${tool.ok ? 'ok' : 'failed'}`,
      ...(tool.summary ? [`summary: ${tool.summary}`] : []),
    ].join(' | ')

  const startRelevantMemoryPrefetch = (state: {
    userPrompt: string
    recentTools: RelevantMemoryRecentTool[]
    abortSignal?: AbortSignal
    queryTraceSink?: QueryTraceSink
  }): RelevantMemoryPrefetchHandle => {
    const controller = new AbortController()
    const relayAbort = () => controller.abort()
    if (state.abortSignal?.aborted) {
      controller.abort()
    } else {
      state.abortSignal?.addEventListener('abort', relayAbort, { once: true })
    }

    let settled: RelevantMemoryPrefetchResult | undefined
    let aborted = false
    state.queryTraceSink?.record({
      event: 'memory.prefetch.start',
      data: {
        recentToolCount: state.recentTools.length,
      },
    })

    void loadPromptMemoryContext(
      options.cwd,
      state.userPrompt,
      configured.env,
      {
        client,
        model: runtime.primary.model,
        queryTraceSink: state.queryTraceSink,
        excludedPaths: getExcludedMemoryPaths(),
        remainingSessionBytes: Math.max(
          0,
          MAX_SURFACED_MEMORY_SESSION_BYTES - surfacedMemoryBytes,
        ),
        recentTools: state.recentTools.map(formatRecentMemoryTool),
        signal: controller.signal,
      },
    )
      .then(memory => {
        if (aborted || controller.signal.aborted) {
          return
        }

        const message = createRelevantMemoryReminderMessage(memory)
        settled = {
          messages: message ? [message] : [],
          recalledPaths: memory.recalledEntries.flatMap(entry => [
            entry.path,
            entry.relativePath,
          ]),
          recalledBytes: memory.recalledBytes,
          skippedAlreadySurfacedCount: memory.skippedAlreadySurfacedCount,
          skippedBySessionByteLimitCount:
            memory.skippedBySessionByteLimitCount,
        }
        state.queryTraceSink?.record({
          event: 'memory.prefetch.settled',
          data: {
            recalledCount: memory.recalledEntries.length,
            recalledPaths: memory.recalledEntries.map(entry => entry.path),
            recalledBytes: memory.recalledBytes,
            skippedAlreadySurfacedCount:
              memory.skippedAlreadySurfacedCount,
            skippedBySessionByteLimitCount:
              memory.skippedBySessionByteLimitCount,
          },
        })
      })
      .finally(() => {
        state.abortSignal?.removeEventListener('abort', relayAbort)
      })

    return {
      getSettled: () => settled,
      abort: () => {
        aborted = true
        controller.abort()
        state.abortSignal?.removeEventListener('abort', relayAbort)
        state.queryTraceSink?.record({
          event: 'memory.prefetch.abort',
        })
      },
    }
  }

  const consumeRelevantMemoryPrefetch = (
    result: RelevantMemoryPrefetchResult,
  ) => {
    for (const memoryPath of result.recalledPaths) {
      surfacedMemoryPaths.add(memoryPath)
    }
    surfacedMemoryBytes += result.recalledBytes
  }

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
    const sessionMeta =
      state.sessionId
        ? await loadSessionMeta(state.sessionId, configured.env)
        : null
    const planMode = sessionMeta?.planMode
    const memory = await loadPromptMemoryContext(
      options.cwd,
      state.userPrompt,
      configured.env,
    )
    state.queryTraceSink?.record({
      event: 'memory.recall',
      data: {
        selectionMode: 'prefetch',
        memoryDir: memory.memoryDir,
        manifestCount: memory.manifestCount,
        recalledCount: 0,
        recalledPaths: [],
        recalledBytes: 0,
        surfacedMemoryBytes,
        skippedAlreadySurfacedCount: 0,
        skippedBySessionByteLimitCount: 0,
        readMemoryPathCount: getReadMemoryPaths().size,
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
      plan: planMode
        ? {
            status: planMode.status,
            planFilePath: planMode.planFilePath,
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
  const sessionMemoryUpdater = createSessionMemoryUpdater({
    client,
    model: runtime.primary.model,
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
          tracePath ?? createQueryTraceFilePath(configured.env, sessionId, options.cwd),
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
    relevantMemoryPrefetcher: startRelevantMemoryPrefetch,
    onRelevantMemoryPrefetchConsumed: consumeRelevantMemoryPrefetch,
    beforeCompactHook: async state => {
      await sessionMemoryUpdater.drainPendingUpdate()
      state.queryTraceSink?.record({
        event: 'session_memory.compact.ready',
        data: {
          sessionId: state.sessionId,
          trigger: state.trigger,
          notesPath: sessionMemoryUpdater.getSessionMemoryPath(state.sessionId),
        },
      })
    },
    turnCompleteHook: async state => {
      if (state.sessionId) {
        sessionMemoryUpdater.scheduleUpdate({
          sessionId: state.sessionId,
          messages: state.messages,
          queryTraceSink: state.queryTraceSink,
        })
      }
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
        createQueryTraceFilePath(configured.env, sessionId, options.cwd),
        sessionId,
      )
      engine.setQueryTraceSink(queryTraceSink)
      return queryTraceSink.filePath
    },
    drainBackgroundWork: async (timeoutMs?: number) => {
      await memoryExtractor.drainPendingExtraction(timeoutMs)
      await sessionMemoryUpdater.drainPendingUpdate(timeoutMs)
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
    env: configured.env,
  }
}

export { formatDclawMdLoadOrder }
