import type { SkillSource } from '../../skills/types.js'
import type { ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'

export type ListLoadedSkillsInput = Record<string, never>

export type ListLoadedSkillsOutput = {
  skills: Array<{
    name: string
    description: string
    source: SkillSource
    path: string
    context?: 'inline' | 'fork'
  }>
}

const DESCRIPTION =
  'List the skills that are currently loaded in this runtime from builtin, user, and project skill directories.'

const PROMPT = `Use this tool to inspect the skills that are currently loaded and available in the active runtime.

Use this before deciding whether a skill needs to be installed from an external store.

Output notes:

- Returns only the skills that are already loaded in the current runtime
- This is not a marketplace search tool
- Prefer this before external skill installation flows so local skills can be reused`

export const listLoadedSkillsTool: Tool<
  ListLoadedSkillsInput,
  ListLoadedSkillsOutput
> = buildTool({
  name: 'ListLoadedSkills',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      skills: {
        type: 'array',
        items: {
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
      },
    },
    required: ['skills'],
    additionalProperties: false,
  },
  isReadOnly() {
    return true
  },
  validate(_input, context) {
    if (!context.skillRegistry) {
      return {
        ok: false,
        error: 'ListLoadedSkills is not available in this runtime',
      }
    }

    return { ok: true }
  },
  async call(_input, context): Promise<ToolResult<ListLoadedSkillsOutput>> {
    if (!context.skillRegistry) {
      return {
        ok: false,
        output: {
          skills: [],
        },
        summary: 'ListLoadedSkills is not available in this runtime',
      }
    }

    const skills = context.skillRegistry
      .list()
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        path: skill.path,
        ...(skill.context ? { context: skill.context } : {}),
      }))

    const summary =
      skills.length === 0
        ? 'No loaded skills are currently available'
        : skills.map(skill => `${skill.name} (${skill.source})`).join('\n')

    return {
      ok: true,
      output: {
        skills,
      },
      summary,
    }
  },
  mapToolResult(result) {
    return result.summary ?? result.output
  },
})
