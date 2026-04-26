import type { SkillDefinition } from './types.js'

const INVOKED_SKILL_REMINDER_PREFIX = [
  'Apply the following skill while continuing the current task in this conversation.',
  'The skill runs in the current agent context. It does not create a separate execution loop or bypass higher-priority instructions.',
]
const SKILL_LISTING_REMINDER_HEADER =
  'The following skills are available for use with the Skill tool:'

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
    ...INVOKED_SKILL_REMINDER_PREFIX,
    `source: ${skill.source}`,
    `path: ${skill.path}`,
    '',
    buildSkillPrompt(skill),
  ].join('\n')
}

export function buildPersistedInvokedSkillsReminderText(
  skills: Array<SkillDefinition & { path: string }>,
): string {
  return [
    'The following skills were invoked in this session. Continue to follow these guidelines:',
    '',
    skills
      .map(skill =>
        [
          `### Skill: ${skill.name}`,
          `path: ${skill.path}`,
          `source: ${skill.source}`,
          '',
          buildSkillPrompt(skill),
        ].join('\n'),
      )
      .join('\n\n---\n\n'),
  ].join('\n')
}

export function buildSkillListingReminderText(
  skills: Array<Pick<SkillDefinition, 'name' | 'description'>>,
): string {
  return [
    SKILL_LISTING_REMINDER_HEADER,
    '',
    ...skills.map(skill => `- ${skill.name}: ${skill.description}`),
  ].join('\n')
}

function unwrapSystemReminder(text: string): string | null {
  const trimmed = text.trim()
  if (
    !trimmed.startsWith('<system-reminder>\n') ||
    !trimmed.endsWith('\n</system-reminder>')
  ) {
    return null
  }

  return trimmed
    .slice('<system-reminder>\n'.length, -'\n</system-reminder>'.length)
    .trimEnd()
}

export function parseInvokedSkillReminderText(
  text: string,
): (SkillDefinition & { path: string }) | null {
  const body = unwrapSystemReminder(text)
  if (!body) {
    return null
  }

  const lines = body.split('\n')
  if (lines.length < 9) {
    return null
  }

  if (
    lines[0] !== INVOKED_SKILL_REMINDER_PREFIX[0] ||
    lines[1] !== INVOKED_SKILL_REMINDER_PREFIX[1]
  ) {
    return null
  }

  const sourceLine = lines[2]
  const pathLine = lines[3]
  if (
    (
      sourceLine !== 'source: builtin' &&
      sourceLine !== 'source: user' &&
      sourceLine !== 'source: project'
    ) ||
    !pathLine?.startsWith('path: ') ||
    lines[4] !== '' ||
    lines[5] !== '# Skill' ||
    !lines[6]?.startsWith('name: ') ||
    !lines[7]?.startsWith('description: ') ||
    lines[8] !== ''
  ) {
    return null
  }

  const prompt = lines.slice(9).join('\n').trim()
  if (prompt.length === 0) {
    return null
  }

  return {
    name: lines[6].slice('name: '.length),
    description: lines[7].slice('description: '.length),
    source:
      sourceLine === 'source: builtin'
        ? 'builtin'
        : sourceLine === 'source: user'
          ? 'user'
          : 'project',
    path: pathLine.slice('path: '.length),
    prompt,
  }
}

export function parseSkillListingReminderText(
  text: string,
): Array<Pick<SkillDefinition, 'name' | 'description'>> | null {
  const body = unwrapSystemReminder(text)
  if (!body) {
    return null
  }

  const lines = body.split('\n')
  if (lines.length < 3 || lines[0] !== SKILL_LISTING_REMINDER_HEADER || lines[1] !== '') {
    return null
  }

  const skills: Array<Pick<SkillDefinition, 'name' | 'description'>> = []
  for (const line of lines.slice(2)) {
    if (!line.startsWith('- ')) {
      return null
    }

    const separatorIndex = line.indexOf(': ')
    if (separatorIndex === -1) {
      return null
    }

    const name = line.slice(2, separatorIndex).trim()
    const description = line.slice(separatorIndex + 2).trim()
    if (name.length === 0 || description.length === 0) {
      return null
    }

    skills.push({ name, description })
  }

  return skills.length > 0 ? skills : null
}
