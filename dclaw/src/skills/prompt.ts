import type { SkillDefinition } from './types.js'

export function buildSkillPrompt(skill: SkillDefinition): string {
  return [
    '# Skill',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    '',
    skill.prompt.trim(),
  ].join('\n').trimEnd()
}

export function buildInvokedSkillReminderText(skill: SkillDefinition & {
  path: string
}): string {
  return [
    'Apply the following skill while continuing the current task in this conversation.',
    'The skill runs in the current agent context. It does not create a separate execution loop or bypass higher-priority instructions.',
    `source: ${skill.source}`,
    `path: ${skill.path}`,
    '',
    buildSkillPrompt(skill),
  ].join('\n')
}
