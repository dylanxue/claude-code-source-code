import { QueryEngine } from '../core/queryEngine.js'
import { createInvokedSkillState } from '../skills/state.js'
import type { ToolContext } from '../types/tool.js'
import type { CreateSubagentRuntimeInput } from './types.js'
import {
  DEFAULT_SUBAGENT_MAX_ITERATIONS,
  DEFAULT_SUBAGENT_MAX_TURNS,
} from './types.js'

const DISALLOWED_SUBAGENT_TOOL_NAMES = new Set([
  'Agent',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'TaskCreate',
  'TaskList',
  'TaskGet',
  'TaskUpdate',
])

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

export function filterSubagentAvailableTools(
  availableTools: string[],
): string[] {
  return availableTools.filter(
    (toolName, index, values): toolName is string =>
      typeof toolName === 'string' &&
      toolName.trim().length > 0 &&
      !DISALLOWED_SUBAGENT_TOOL_NAMES.has(toolName) &&
      values.indexOf(toolName) === index,
  )
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
  const availableTools = filterSubagentAvailableTools(
    input.agent.availableTools.length > 0
      ? [...input.agent.availableTools]
      : [...input.parent.availableTools],
  )

  return {
    sessionId: undefined,
    planFilePath: input.parent.planFilePath,
    cwd: input.agent.cwd || input.parent.cwd,
    availableTools,
    permissionMode: input.agent.permissionMode ?? input.parent.permissionMode,
    readState: new Map(),
    agentRuntime: {
      ...input.parent,
      parentSessionId: input.agent.parentSessionId,
      currentAgentId: input.agent.agentId,
    },
    supportsVisionInput: input.parent.supportsVisionInput,
    visionRuntime: input.parent.visionRuntime,
    skillRegistry: input.parent.skillRegistry,
    invokedSkills: createInvokedSkillState(),
  }
}

export function createSubagentRuntime(
  input: CreateSubagentRuntimeInput,
): SubagentRuntime {
  const limits = resolveSubagentRuntimeLimits(input.agent)
  const engine = new QueryEngine({
    client: input.parent.client,
    provider: input.parent.provider,
    modelLimitsEnv: input.parent.modelLimitsEnv,
    model: input.agent.model ?? input.parent.model,
    systemPromptResolver: input.parent.systemPromptResolver,
    dclawMdEntries: input.parent.dclawMdEntries,
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
