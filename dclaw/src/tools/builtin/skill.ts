import { runAgentToCompletion } from '../../agent/runner.js'
import { filterSubagentAvailableTools } from '../../agent/runtime.js'
import { createAgent } from '../../agent/store.js'
import type { AgentRecord, AgentToolRuntime } from '../../agent/types.js'
import { createTextMessage } from '../../types/message.js'
import type { ToolResult } from '../../types/tool.js'
import { recordInvokedSkill } from '../../skills/state.js'
import {
  buildInvokedSkillReminderText,
  buildSkillPrompt,
} from '../../skills/prompt.js'
import type { LoadedSkill } from '../../skills/types.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './skillPrompt.js'

export type SkillToolInput = {
  skill_name?: string
}

type SkillToolOutput = {
  skill: {
    name: string
    description: string
    source: 'builtin' | 'user' | 'project'
    path: string
    context?: 'inline' | 'fork'
  }
  applied: boolean
  execution_context: 'inline' | 'fork'
  agent?: {
    agent_id: string
    status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped'
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

function resolveSkill(
  skillName: string | undefined,
  context: {
    skillRegistry?: {
      get(name: string): LoadedSkill | undefined
      list(): LoadedSkill[]
    }
  },
): LoadedSkill | null {
  const normalized = trimOrUndefined(skillName)
  if (!normalized) {
    return null
  }

  return context.skillRegistry?.get(normalized) ?? null
}

function buildReminderMessage(skill: LoadedSkill) {
  return createTextMessage(
    'user',
    `<system-reminder>\n${buildInvokedSkillReminderText(skill)}\n</system-reminder>`,
  )
}

function buildForkedSkillPrompt(skill: LoadedSkill): string {
  return buildSkillPrompt(skill)
}

function resolveSkillExecutionContext(
  skill: LoadedSkill,
): 'inline' | 'fork' {
  return skill.context === 'fork' ? 'fork' : 'inline'
}

function isSubagentContext(context: {
  sessionId?: string
  agentRuntime?: AgentToolRuntime
}): boolean {
  return !context.sessionId && Boolean(context.agentRuntime?.currentAgentId)
}

function resolveEffectiveSkillExecutionContext(
  skill: LoadedSkill,
  context: {
    sessionId?: string
    agentRuntime?: AgentToolRuntime
  },
): 'inline' | 'fork' {
  const requested = resolveSkillExecutionContext(skill)
  if (requested !== 'fork') {
    return requested
  }

  return isSubagentContext(context) ? 'inline' : 'fork'
}

function resolveForkParentSessionId(context: {
  sessionId?: string
  agentRuntime?: AgentToolRuntime
}): string | undefined {
  return context.sessionId ?? context.agentRuntime?.parentSessionId
}

function assertForkRuntime(
  context: {
    agentRuntime?: AgentToolRuntime
  },
): AgentToolRuntime {
  if (!context.agentRuntime) {
    throw new Error('Skill fork execution is not available in this runtime')
  }

  return context.agentRuntime
}

function toForkOutput(
  skill: LoadedSkill,
  agent: AgentRecord,
): SkillToolOutput {
  return {
    skill: {
      name: skill.name,
      description: skill.description,
      source: skill.source,
      path: skill.path,
      context: 'fork',
    },
    applied: true,
    execution_context: 'fork',
    agent: {
      agent_id: agent.agentId,
      status: agent.status,
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

function toInlineOutput(skill: LoadedSkill): SkillToolOutput {
  return {
    skill: {
      name: skill.name,
      description: skill.description,
      source: skill.source,
      path: skill.path,
      ...(skill.context ? { context: skill.context } : {}),
    },
    applied: true,
    execution_context: 'inline',
  }
}

export const skillTool: Tool<SkillToolInput, SkillToolOutput> = buildTool({
  name: 'Skill',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {
      skill_name: {
        type: 'string',
      },
    },
    required: ['skill_name'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      skill: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          source: {
            type: 'string',
            enum: ['builtin', 'user', 'project'],
          },
          path: { type: 'string' },
          context: {
            type: 'string',
            enum: ['inline', 'fork'],
          },
        },
        required: ['name', 'description', 'source', 'path'],
        additionalProperties: false,
      },
      applied: {
        type: 'boolean',
      },
      execution_context: {
        type: 'string',
        enum: ['inline', 'fork'],
      },
      agent: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['queued', 'running', 'completed', 'failed', 'stopped'],
          },
          completed_at: { type: 'string' },
          trace_path: { type: 'string' },
        },
        required: ['agent_id', 'status'],
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
    required: ['skill', 'applied', 'execution_context'],
    additionalProperties: false,
  },
  isEnabled(context) {
    return (context.skillRegistry?.list().length ?? 0) > 0
  },
  isReadOnly() {
    return true
  },
  validate(input, context) {
    const skillName = trimOrUndefined(input.skill_name)
    if (!skillName) {
      return {
        ok: false,
        error: 'Skill requires a non-empty skill_name',
      }
    }

    if (!context.skillRegistry || context.skillRegistry.list().length === 0) {
      return {
        ok: false,
        error: 'Skill is not available in this runtime',
      }
    }

    if (!context.skillRegistry.get(skillName)) {
      return {
        ok: false,
        error: `Unknown skill: ${skillName}`,
      }
    }

    return { ok: true }
  },
  async call(input, context): Promise<ToolResult<SkillToolOutput>> {
    const skill = resolveSkill(input.skill_name, context)
    if (!skill) {
      throw new Error(
        `Unknown skill: ${trimOrUndefined(input.skill_name) ?? '<empty>'}`,
      )
    }

    if (resolveEffectiveSkillExecutionContext(skill, context) === 'fork') {
      const runtime = assertForkRuntime(context)
      const parentSessionId = resolveForkParentSessionId(context)
      if (!parentSessionId) {
        throw new Error('Skill fork execution requires an active parent session')
      }

      const env = runtime.env ?? process.env
      const agent = await createAgent({
        parentAgentId: runtime.currentAgentId,
        parentSessionId,
        parentTurnId: context.activeTurnId,
        task: `Apply skill ${skill.name}`,
        cwd: context.cwd,
        provider: runtime.provider ?? runtime.client.providerName,
        model: runtime.model,
        permissionMode: context.permissionMode,
        availableTools: filterSubagentAvailableTools(context.availableTools),
        pendingPrompts: [buildForkedSkillPrompt(skill)],
        env,
      })
      const completed = await runAgentToCompletion(
        agent.agentId,
        parentSessionId,
        runtime,
        env,
      )

      return {
        ok: true,
        output: toForkOutput(skill, completed.agent),
        summary:
          completed.agent.summary ??
          completed.agent.outputText ??
          completed.agent.lastError ??
          `Applied skill ${skill.name} via forked subagent ${completed.agent.agentId}`,
      }
    }

    recordInvokedSkill(context.invokedSkills, skill)

    return {
      ok: true,
      output: toInlineOutput(skill),
      summary: `Applied skill ${skill.name}`,
      newMessages: [buildReminderMessage(skill)],
    }
  },
})
