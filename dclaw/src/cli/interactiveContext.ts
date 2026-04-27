import { createSession } from '../session/store.js'
import type { ReplCommandContext, ReplSessionState } from './replCommands.js'
import {
  prepareCliRuntime,
  type PreparedCliRuntime,
} from './runtime.js'
import type { CommonCliOptions, InteractiveCommand } from './types.js'

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
> & {
  queryTracePath?: string
  replSession: ReplSessionState
  replOptions: CommonCliOptions
  replContext: ReplCommandContext
}

export async function createInteractiveContext(
  command: InteractiveCommand,
): Promise<InteractiveContextState> {
  const prepared = await prepareCliRuntime(command.options, 'interactive')
  const session = await createSession({
    cwd: command.options.cwd,
    mode: 'interactive',
    provider: prepared.runtime.provider,
    model: prepared.runtime.model,
  })
  prepared.engine.setSessionId(session.sessionId)
  const queryTracePath = await prepared.rotateQueryTrace(session.sessionId)

  const replSession: ReplSessionState = {
    sessionId: session.sessionId,
    mode: 'interactive',
    provider: prepared.runtime.provider,
    providerSource: prepared.runtime.providerSource,
    model: prepared.runtime.model,
    modelSource: prepared.runtime.modelSource,
    permissionMode: prepared.permissionMode,
    permissionModeSource: prepared.permissionModeSource,
  }
  const replOptions = { ...command.options }

  const state: InteractiveContextState = {
    ...prepared,
    queryTracePath,
    replSession,
    replOptions,
    replContext: {} as ReplCommandContext,
  }

  state.replContext = {
    engine: state.engine,
    options: state.replOptions,
    session: state.replSession,
    rotateQueryTrace: state.rotateQueryTrace,
    switchRuntime: async (runtimeName: string) => {
      await state.drainBackgroundWork()
      const nextOptions = {
        ...state.replOptions,
        runtime: runtimeName,
        permissionMode:
          state.replSession.permissionMode as typeof state.replOptions.permissionMode,
      }
      const nextPrepared = await prepareCliRuntime(
        nextOptions,
        'interactive',
        state.replContext.engine.getMessages(),
      )
      const nextEngine = nextPrepared.engine
      nextEngine.setSessionId(state.replSession.sessionId)
      nextEngine.setPlanFilePath(state.replContext.engine.getPlanFilePath())
      nextEngine.setPermissionMode(
        state.replSession.permissionMode as typeof nextPrepared.permissionMode,
      )
      const nextQueryTracePath = await nextPrepared.rotateQueryTrace(
        state.replSession.sessionId,
      )

      state.runtime = nextPrepared.runtime
      state.dclawMdEntries = nextPrepared.dclawMdEntries
      state.toolRegistry = nextPrepared.toolRegistry
      state.engine = nextEngine
      state.rotateQueryTrace = nextPrepared.rotateQueryTrace
      state.drainBackgroundWork = nextPrepared.drainBackgroundWork
      state.permissionMode =
        state.replSession.permissionMode as typeof nextPrepared.permissionMode
      state.permissionModeSource =
        state.replSession.permissionModeSource as typeof nextPrepared.permissionModeSource
      state.queryTracePath = nextQueryTracePath
      state.replOptions.runtime = runtimeName
      state.replContext.engine = nextEngine
      state.replContext.rotateQueryTrace = nextPrepared.rotateQueryTrace
      state.replSession.provider = nextPrepared.runtime.provider
      state.replSession.providerSource = nextPrepared.runtime.providerSource
      state.replSession.model = nextPrepared.runtime.model
      state.replSession.modelSource = nextPrepared.runtime.modelSource

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
  'replOptions' | 'replSession'
>): string {
  return state.replSession.model
    ? `${state.replSession.model}${state.replOptions.stream ? '' : ' no-stream'}`
    : state.replSession.provider
}
