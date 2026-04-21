import { QueryEngine } from '../core/queryEngine.js'
import type { ToolContext } from '../types/tool.js'
import type { CreateSubagentRuntimeInput } from './types.js'
import {
  DEFAULT_SUBAGENT_MAX_ITERATIONS,
  DEFAULT_SUBAGENT_MAX_TURNS,
} from './types.js'

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback
  }

  return value
}

export type SubagentRuntimeLimits = {
  maxTurns: number
  maxIterations: number
}

export type SubagentRuntime = SubagentRuntimeLimits & {
  engine: QueryEngine
}

export function resolveSubagentRuntimeLimits(input: {
  maxTurns?: number
  maxIterations?: number
}): SubagentRuntimeLimits {
  return {
    maxTurns: normalizePositiveInteger(
      input.maxTurns,
      DEFAULT_SUBAGENT_MAX_TURNS,
    ),
    maxIterations: normalizePositiveInteger(
      input.maxIterations,
      DEFAULT_SUBAGENT_MAX_ITERATIONS,
    ),
  }
}

export function createSubagentToolContext(
  input: CreateSubagentRuntimeInput,
): ToolContext {
  return {
    sessionId: input.agent.agentId,
    planFilePath: input.parent.planFilePath,
    cwd: input.agent.cwd || input.parent.cwd,
    availableTools:
      input.agent.availableTools.length > 0
        ? [...input.agent.availableTools]
        : [...input.parent.availableTools],
    permissionMode: input.agent.permissionMode ?? input.parent.permissionMode,
    readState: new Map(),
    askUserQuestions: input.parent.askUserQuestions,
  }
}

export function createSubagentRuntime(
  input: CreateSubagentRuntimeInput,
): SubagentRuntime {
  const limits = resolveSubagentRuntimeLimits(input.agent)
  const engine = new QueryEngine({
    client: input.parent.client,
    provider: input.parent.provider,
    model: input.agent.model ?? input.parent.model,
    toolRegistry: input.parent.toolRegistry,
    toolContext: createSubagentToolContext(input),
    initialMessages: input.initialMessages,
    maxIterations: limits.maxIterations,
    sessionMode: 'interactive',
  })

  return {
    ...limits,
    engine,
  }
}
