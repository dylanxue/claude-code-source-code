export const DESCRIPTION =
  'Load a reusable skill into the current conversation context.'

export const PROMPT = `Use this tool to apply a known skill in the current agent context.

Usage notes:

- Provide the exact skill_name you want to apply
- Use this only for skills that are already known from prior context, user instructions, or surfaced runtime context
- Do NOT guess skill names or invent new skills
- Skills run inline by default; if a skill explicitly declares fork execution, it runs in a separate subagent context
- The injected skill remains subject to higher-priority system, developer, and user instructions

Skill discovery and installation note:

- When the user wants to find, install, or enable a skill from a local directory or from SkillHub, prefer the builtin \`install-skills\` skill first
- The \`install-skills\` skill is responsible for checking local skills before any external install flow

Document workflow notes:

- When Read or WebFetch returns structured unsupported content for a document, prefer this tool before improvising a custom extraction flow
- Use the exact builtin skill name that matches the unsupported result:
- \`pdf\` for PDF documents
- \`doc\` for \`.doc\` and \`.docx\`
- \`spreadsheet\` for \`.csv\`, \`.tsv\`, \`.xls\`, \`.xlsx\`, and similar workbook files
- After applying the skill, continue with Read, WebFetch, and Bash as directed by the skill instructions

When not to use this tool:

- If you need a one-off plan or explanation, continue directly without a skill
- If you need a custom separate execution context that is not already encoded in the skill metadata, use Agent instead of Skill
`
