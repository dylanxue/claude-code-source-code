import { createTextMessage } from '../../types/message.js'
import type { ToolResult } from '../../types/tool.js'
import { recordInvokedSkill } from '../../skills/state.js'
import { buildInvokedSkillReminderText } from '../../skills/prompt.js'
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
    source: 'builtin' | 'project'
    path: string
  }
  applied: boolean
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
            enum: ['builtin', 'project'],
          },
          path: { type: 'string' },
        },
        required: ['name', 'description', 'source', 'path'],
        additionalProperties: false,
      },
      applied: {
        type: 'boolean',
      },
    },
    required: ['skill', 'applied'],
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

    recordInvokedSkill(context.invokedSkills, skill)

    return {
      ok: true,
      output: {
        skill: {
          name: skill.name,
          description: skill.description,
          source: skill.source,
          path: skill.path,
        },
        applied: true,
      },
      summary: `Applied skill ${skill.name}`,
      newMessages: [buildReminderMessage(skill)],
    }
  },
})
