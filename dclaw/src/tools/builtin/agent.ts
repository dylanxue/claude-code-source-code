import { getRunningAgentPromise, startAgentRun } from '../../agent/scheduler.js'
import { filterSubagentAvailableTools } from '../../agent/runtime.js'
import { createTranscriptOnlyTextMessage } from '../../types/message.js'
import type { PermissionMode, ToolResult } from '../../types/tool.js'
import { runAgentToCompletion } from '../../agent/runner.js'
import { createAgent, loadAgent, updateAgent } from '../../agent/store.js'
import type {
  AgentRecord,
  AgentStatus,
  AgentToolRuntime,
} from '../../agent/types.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './agentPrompt.js'

type AgentAction = 'spawn' | 'send' | 'wait' | 'stop'

export type AgentToolInput = {
  action: AgentAction
  agent_id?: string
  task?: string
  message?: string
  cwd?: string
  model?: string
  permission_mode?: PermissionMode
  allowed_tools?: string[]
  max_turns?: number
  max_iterations?: number
}

type AgentToolOutput = {
  action: AgentAction
  agent: {
    agent_id: string
    status: AgentStatus
    task: string
    completed_at?: string
    trace_path?: string
  }
  result?: {
    summary?: string
    output_text?: string
    error?: string
  }
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function normalizeAllowedTools(
  requested: string[] | undefined,
  availableTools: string[],
): string[] {
  if (!Array.isArray(requested) || requested.length === 0) {
    return [...availableTools]
  }

  return requested.filter(
    (toolName, index, values): toolName is string =>
      typeof toolName === 'string' &&
      toolName.trim().length > 0 &&
      availableTools.includes(toolName) &&
      values.indexOf(toolName) === index,
  )
}

function assertAgentRuntime(
  context: {
    sessionId?: string
    agentRuntime?: AgentToolRuntime
  },
): AgentToolRuntime {
  if (!context.sessionId) {
    throw new Error('Agent requires an active parent session')
  }

  if (!context.agentRuntime) {
    throw new Error('Agent is not available in this runtime')
  }

  return context.agentRuntime
}

function buildAgentNote(agent: AgentRecord, message: string) {
  return createTranscriptOnlyTextMessage(
    'system',
    `[subagent ${agent.agentId}] ${message}`,
  )
}

function toToolOutput(
  action: AgentAction,
  agent: AgentRecord,
): AgentToolOutput {
  return {
    action,
    agent: {
      agent_id: agent.agentId,
      status: agent.status,
      task: agent.task,
      completed_at: agent.completedAt,
      trace_path: agent.tracePath,
    },
    result:
      agent.summary || agent.outputText || agent.lastError
        ? {
            summary: agent.summary,
            output_text: agent.outputText,
            error: agent.lastError,
          }
        : undefined,
  }
}

function summarizeMappedResult(output: AgentToolOutput): string {
  const base = `Subagent ${output.agent.agent_id} ${output.agent.status}`
  if (output.action === 'spawn') {
    return `${base}: ${output.agent.task}`
  }
  if (output.action === 'send') {
    return `${base}. Follow-up queued.`
  }
  if (output.action === 'stop') {
    return `${base}.`
  }
  if (output.result?.summary) {
    return `${base}: ${output.result.summary}`
  }
  if (output.result?.error) {
    return `${base}: ${output.result.error}`
  }
  return `${base}.`
}

async function loadRequiredAgent(
  agentId: string | undefined,
  parentSessionId: string,
  env: NodeJS.ProcessEnv,
): Promise<AgentRecord> {
  const normalizedAgentId = trimOrUndefined(agentId)
  if (!normalizedAgentId) {
    throw new Error('Agent requires a non-empty agent_id')
  }

  const agent = await loadAgent(normalizedAgentId, parentSessionId, env)
  if (!agent) {
    throw new Error(`Subagent not found: ${normalizedAgentId}`)
  }

  return agent
}

export const agentTool: Tool<AgentToolInput, AgentToolOutput> = buildTool({
  name: 'Agent',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['spawn', 'send', 'wait', 'stop'],
      },
      agent_id: {
        type: 'string',
      },
      task: {
        type: 'string',
      },
      message: {
        type: 'string',
      },
      cwd: {
        type: 'string',
      },
      model: {
        type: 'string',
      },
      permission_mode: {
        type: 'string',
        enum: ['default', 'accept-edits', 'bypass-permissions', 'plan'],
      },
      allowed_tools: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      max_turns: {
        type: 'integer',
      },
      max_iterations: {
        type: 'integer',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['spawn', 'send', 'wait', 'stop'],
      },
      agent: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['queued', 'running', 'completed', 'failed', 'stopped'],
          },
          task: { type: 'string' },
          completed_at: { type: 'string' },
          trace_path: { type: 'string' },
        },
        required: ['agent_id', 'status', 'task'],
        additionalProperties: false,
      },
      result: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          output_text: { type: 'string' },
          error: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    required: ['action', 'agent'],
    additionalProperties: false,
  },
  isEnabled(context) {
    return Boolean(context.sessionId && context.agentRuntime)
  },
  isReadOnly(input) {
    return input.action === 'wait'
  },
  validate(input, context) {
    if (
      input.action !== 'spawn' &&
      input.action !== 'send' &&
      input.action !== 'wait' &&
      input.action !== 'stop'
    ) {
      return {
        ok: false,
        error: 'Agent requires action to be one of spawn, send, wait, or stop',
      }
    }

    if (!context.sessionId) {
      return {
        ok: false,
        error: 'Agent requires an active sessionId in tool context',
      }
    }

    if (!context.agentRuntime) {
      return {
        ok: false,
        error: 'Agent is not available in this runtime',
      }
    }

    if (input.action === 'spawn') {
      if (!trimOrUndefined(input.task)) {
        return {
          ok: false,
          error: 'Agent spawn requires a non-empty task',
        }
      }

      return { ok: true }
    }

    if (!trimOrUndefined(input.agent_id)) {
      return {
        ok: false,
        error: `Agent ${input.action} requires a non-empty agent_id`,
      }
    }

    if (input.action === 'send' && !trimOrUndefined(input.message)) {
      return {
        ok: false,
        error: 'Agent send requires a non-empty message',
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<AgentToolOutput>> {
    const runtime = assertAgentRuntime(context)
    const env = runtime.env ?? process.env
    const parentSessionId = context.sessionId!

    if (input.action === 'spawn') {
      const task = trimOrUndefined(input.task)!
      const initialPrompt = trimOrUndefined(input.message) ?? task
      const agent = await createAgent({
        agentId: trimOrUndefined(input.agent_id),
        parentSessionId,
        parentTurnId: context.activeTurnId,
        task,
        cwd: trimOrUndefined(input.cwd) ?? context.cwd,
        provider: runtime.provider ?? runtime.client.providerName,
        model: trimOrUndefined(input.model) ?? runtime.model,
        permissionMode: input.permission_mode ?? context.permissionMode,
        availableTools: normalizeAllowedTools(
          input.allowed_tools,
          filterSubagentAvailableTools(context.availableTools),
        ),
        pendingPrompts: [initialPrompt],
        maxTurns: input.max_turns,
        maxIterations: input.max_iterations,
        env,
      })
      const output = toToolOutput('spawn', agent)
      void startAgentRun(agent.agentId, parentSessionId, runtime, env)

      return {
        ok: true,
        output,
        summary: summarizeMappedResult(output),
        newMessages: [
          buildAgentNote(agent, `spawned for task: ${agent.task}`),
        ],
      }
    }

    if (input.action === 'send') {
      const agent = await loadRequiredAgent(input.agent_id, parentSessionId, env)
      const message = trimOrUndefined(input.message)!
      const updated =
        (await updateAgent(
          agent.agentId,
          parentSessionId,
          current => ({
            ...current,
            status: 'queued',
            completedAt: undefined,
            pendingPrompts: [...current.pendingPrompts, message],
            summary: undefined,
            outputText: undefined,
            lastError: undefined,
          }),
          env,
        )) ?? agent
      const output = toToolOutput('send', updated)
      void startAgentRun(updated.agentId, parentSessionId, runtime, env)

      return {
        ok: true,
        output,
        summary: summarizeMappedResult(output),
      }
    }

    if (input.action === 'stop') {
      const agent = await loadRequiredAgent(input.agent_id, parentSessionId, env)
      const updated =
        (await updateAgent(
          agent.agentId,
          parentSessionId,
          current => ({
            ...current,
            status: 'stopped',
            completedAt: new Date().toISOString(),
            pendingPrompts: [],
          }),
          env,
        )) ?? agent
      const output = toToolOutput('stop', updated)

      return {
        ok: true,
        output,
        summary: summarizeMappedResult(output),
        newMessages: [
          buildAgentNote(updated, 'stopped before completion'),
        ],
      }
    }

    const existing = await loadRequiredAgent(input.agent_id, parentSessionId, env)
    const settled =
      existing.status === 'queued' || existing.status === 'running'
        ? (
            await (
              getRunningAgentPromise(parentSessionId, existing.agentId) ??
              startAgentRun(
                existing.agentId,
                parentSessionId,
                runtime,
                env,
              )
            )
          ).agent
        : existing
    const output = toToolOutput('wait', settled)
    const note =
      settled.status === 'completed'
        ? buildAgentNote(
            settled,
            `completed: ${settled.summary ?? 'done'}`,
          )
        : settled.status === 'failed'
        ? buildAgentNote(
            settled,
            `failed: ${settled.lastError ?? 'unknown error'}`,
          )
        : settled.status === 'stopped'
        ? buildAgentNote(settled, 'stopped')
        : undefined

    return {
      ok: settled.status !== 'failed',
      output,
      summary: summarizeMappedResult(output),
      ...(note ? { newMessages: [note] } : {}),
    }
  },
  mapToolResult(result) {
    return result.summary ?? result.output
  },
})
