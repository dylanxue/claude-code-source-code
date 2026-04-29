import { createSession } from '../session/store.js'
import type { SlashCommandContext, InteractiveSessionState } from './slashCommands.js'
import {
  prepareCliRuntime,
  type PreparedCliRuntime,
} from './runtime.js'
import type { CommonCliOptions, InteractiveCommand } from './types.js'
import { readCliVersion } from './version.js'

export type InteractiveContextState = Pick<
  PreparedCliRuntime,
  | 'runtime'
  | 'dclawMdEntries'
  | 'toolRegistry'
  | 'engine'
  | 'rotateQueryTrace'
  | 'drainBackgroundWork'
  | 'permissionMode'
  | 'permissionModeSource'
  | 'listSkillStatuses'
  | 'setSkillEnabled'
  | 'env'
> & {
  version: string
  queryTracePath?: string
  interactiveSession: InteractiveSessionState
  interactiveOptions: CommonCliOptions
  slashCommandContext: SlashCommandContext
}

export async function createInteractiveContext(
  command: InteractiveCommand,
): Promise<InteractiveContextState> {
  const prepared = await prepareCliRuntime(command.options, 'interactive')
  const version = await readCliVersion()
  const session = await createSession({
    cwd: command.options.cwd,
    mode: 'interactive',
    runtimeName: prepared.runtime.runtimeName,
    provider: prepared.runtime.provider,
    model: prepared.runtime.model,
    env: prepared.env,
  })
  prepared.engine.setSessionId(session.sessionId)
  const queryTracePath = await prepared.rotateQueryTrace(session.sessionId)

  const interactiveSession: InteractiveSessionState = {
    sessionId: session.sessionId,
    mode: 'interactive',
    runtimeName: prepared.runtime.runtimeName,
    provider: prepared.runtime.provider,
    providerSource: prepared.runtime.providerSource,
    model: prepared.runtime.model,
    modelSource: prepared.runtime.modelSource,
    permissionMode: prepared.permissionMode,
    permissionModeSource: prepared.permissionModeSource,
  }
  const interactiveOptions = { ...command.options }

  const state: InteractiveContextState = {
    ...prepared,
    version,
    queryTracePath,
    interactiveSession,
    interactiveOptions,
    slashCommandContext: {} as SlashCommandContext,
  }

  state.slashCommandContext = {
    engine: state.engine,
    options: state.interactiveOptions,
    session: state.interactiveSession,
    env: prepared.env,
    rotateQueryTrace: state.rotateQueryTrace,
    listSkillStatuses: state.listSkillStatuses,
    setSkillEnabled: state.setSkillEnabled,
    switchRuntime: async (runtimeName: string) => {
      await state.drainBackgroundWork()
      const nextOptions = {
        ...state.interactiveOptions,
        runtime: runtimeName,
        permissionMode:
          state.interactiveSession.permissionMode as typeof state.interactiveOptions.permissionMode,
      }
      const nextPrepared = await prepareCliRuntime(
        nextOptions,
        'interactive',
        state.slashCommandContext.engine.getMessages(),
      )
      const nextEngine = nextPrepared.engine
      nextEngine.setSessionId(state.interactiveSession.sessionId)
      nextEngine.setPlanFilePath(state.slashCommandContext.engine.getPlanFilePath())
      nextEngine.setPermissionMode(
        state.interactiveSession.permissionMode as typeof nextPrepared.permissionMode,
      )
      const nextQueryTracePath = await nextPrepared.rotateQueryTrace(
        state.interactiveSession.sessionId,
      )

      state.runtime = nextPrepared.runtime
      state.dclawMdEntries = nextPrepared.dclawMdEntries
      state.toolRegistry = nextPrepared.toolRegistry
      state.engine = nextEngine
      state.rotateQueryTrace = nextPrepared.rotateQueryTrace
      state.drainBackgroundWork = nextPrepared.drainBackgroundWork
      state.listSkillStatuses = nextPrepared.listSkillStatuses
      state.setSkillEnabled = nextPrepared.setSkillEnabled
      state.permissionMode =
        state.interactiveSession.permissionMode as typeof nextPrepared.permissionMode
      state.permissionModeSource =
        state.interactiveSession.permissionModeSource as typeof nextPrepared.permissionModeSource
      state.queryTracePath = nextQueryTracePath
      state.interactiveOptions.runtime = runtimeName
      state.slashCommandContext.engine = nextEngine
      state.slashCommandContext.env = nextPrepared.env
      state.slashCommandContext.rotateQueryTrace = nextPrepared.rotateQueryTrace
      state.slashCommandContext.listSkillStatuses = nextPrepared.listSkillStatuses
      state.slashCommandContext.setSkillEnabled = nextPrepared.setSkillEnabled
      state.interactiveSession.runtimeName = nextPrepared.runtime.runtimeName
      state.interactiveSession.provider = nextPrepared.runtime.provider
      state.interactiveSession.providerSource = nextPrepared.runtime.providerSource
      state.interactiveSession.model = nextPrepared.runtime.model
      state.interactiveSession.modelSource = nextPrepared.runtime.modelSource

      return {
        runtime: nextPrepared.runtime,
        queryTracePath: nextQueryTracePath,
      }
    },
  }

  return state
}

export function getInteractiveRuntimeLabel(state: Pick<
  InteractiveContextState,
  'runtime' | 'interactiveSession'
>): string {
  return (
    state.runtime.runtimeName ??
    state.interactiveSession.runtimeName ??
    state.interactiveSession.model ??
    state.interactiveSession.provider
  )
}
