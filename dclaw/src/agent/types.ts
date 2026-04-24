import type { LlmClient } from '../llm/types.js'
import type { LlmProviderName } from '../llm/providerNames.js'
import type { QueryEngineOptions } from '../core/queryEngine.js'
import type { QueryTraceSink } from '../core/queryTrace.js'
import type { DclawMdEntry } from '../prompt/dclawMd.js'
import type { SkillRegistry } from '../skills/registry.js'
import type { Message } from '../types/message.js'
import type {
  PermissionMode,
  ToolContext,
  VisionRuntime,
} from '../types/tool.js'
import type { ToolRegistry } from '../tools/registry.js'

export const DEFAULT_SUBAGENT_MAX_TURNS = 16
export const DEFAULT_SUBAGENT_MAX_ITERATIONS = 64

export type AgentStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'

export type AgentRecord = {
  agentId: string
  parentAgentId?: string
  parentSessionId?: string
  parentTurnId?: string
  status: AgentStatus
  task: string
  cwd: string
  provider: string
  model?: string
  permissionMode: PermissionMode
  availableTools: string[]
  pendingPrompts: string[]
  maxTurns: number
  maxIterations: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  summary?: string
  outputText?: string
  tracePath?: string
  lastError?: string
}

export type SessionAgentLink = {
  parentTurnId: string
  agentId: string
  status: AgentStatus
  task: string
  createdAt: string
  updatedAt: string
}

export type CreateAgentInput = {
  agentId?: string
  parentAgentId?: string
  parentSessionId: string
  parentTurnId?: string
  status?: AgentStatus
  task: string
  cwd: string
  provider: string
  model?: string
  permissionMode: PermissionMode
  availableTools: string[]
  pendingPrompts?: string[]
  maxTurns?: number
  maxIterations?: number
  env?: NodeJS.ProcessEnv
}

export type ListAgentsInput = {
  parentAgentId?: string
  parentSessionId: string
  status?: AgentStatus
  env?: NodeJS.ProcessEnv
}

export type ParentAgentRuntime = {
  client: LlmClient
  provider?: LlmProviderName
  model?: string
  cwd: string
  env?: NodeJS.ProcessEnv
  permissionMode: PermissionMode
  availableTools: string[]
  planFilePath?: string
  parentSessionId?: string
  currentAgentId?: string
  supportsVisionInput?: boolean
  visionRuntime?: VisionRuntime
  askUserQuestions?: ToolContext['askUserQuestions']
  toolRegistry: ToolRegistry
  skillRegistry?: SkillRegistry
  modelLimitsEnv?: NodeJS.ProcessEnv
  systemPromptResolver?: QueryEngineOptions['systemPromptResolver']
  dclawMdEntries?: DclawMdEntry[]
  createQueryTraceSink?: (
    sessionId: string,
    tracePath?: string,
  ) => Promise<QueryTraceSink | undefined>
}

export type AgentToolRuntime = ParentAgentRuntime

export type CreateSubagentRuntimeInput = {
  agent: AgentRecord
  parent: ParentAgentRuntime
  initialMessages?: Message[]
}
