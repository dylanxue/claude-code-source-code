import type { ReloadSkillsResult, ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'

export const reloadSkillsTool: Tool<Record<string, never>, ReloadSkillsResult> =
  buildTool({
    name: 'ReloadSkills',
    description: 'Reload available skills from builtin, user, and project skill directories.',
    prompt() {
      return `Use this tool after new skills are added to the filesystem and you need them to become available in the current conversation immediately.

Usage notes:

- Prefer this after installing or copying skills into .dclaw/skills or ~/.dclaw/skills during the current session
- This tool only refreshes the in-memory skill registry for the current runtime
- After reloading, you can call the Skill tool again with newly available skill names`
    },
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        reloaded: { type: 'boolean' },
        totalSkills: { type: 'integer' },
        skillNames: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['reloaded', 'totalSkills', 'skillNames'],
      additionalProperties: false,
    },
    isEnabled(context) {
      return typeof context.reloadSkills === 'function'
    },
    isReadOnly() {
      return true
    },
    async validate(_input, context) {
      if (typeof context.reloadSkills !== 'function') {
        return {
          ok: false,
          error: 'ReloadSkills is not available in this runtime',
        }
      }

      return { ok: true }
    },
    async call(_input, context): Promise<ToolResult<ReloadSkillsResult>> {
      if (typeof context.reloadSkills !== 'function') {
        return {
          ok: false,
          output: {
            reloaded: false,
            totalSkills: 0,
            skillNames: [],
          },
          summary: 'ReloadSkills is not available in this runtime',
        }
      }

      const output = await context.reloadSkills()
      const summary =
        output.skillNames.length > 0
          ? `Reloaded ${output.totalSkills} skills`
          : 'Reloaded skills (no skills are currently available)'

      return {
        ok: true,
        output,
        summary,
      }
    },
  })
