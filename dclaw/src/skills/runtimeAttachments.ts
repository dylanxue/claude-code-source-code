import {
  createTextMessage,
  type Message,
  type RuntimeSkillListingMode,
  withRuntimeAttachment,
} from '../types/message.js'
import {
  buildInvokedSkillReminderText,
  buildPersistedInvokedSkillsReminderText,
  buildSkillListingReminderText,
  buildSkillNameListingReminderText,
} from './prompt.js'
import type { LoadedSkill, SkillDefinition } from './types.js'

function wrapSystemReminder(text: string): string {
  return `<system-reminder>\n${text}\n</system-reminder>`
}

function withSkillAttachment(
  message: Message,
  attachment: NonNullable<Message['runtimeAttachment']>,
): Message {
  return withRuntimeAttachment(message, attachment)
}

export function createSkillListingAttachmentMessage(
  mode: RuntimeSkillListingMode,
  skills: Array<Pick<SkillDefinition, 'name' | 'description'>>,
): Message | null {
  if (skills.length === 0) {
    return null
  }

  const text =
    mode === 'names_only'
      ? buildSkillNameListingReminderText(skills.map(skill => skill.name))
      : buildSkillListingReminderText(skills)

  return withSkillAttachment(
    createTextMessage('user', wrapSystemReminder(text)),
    {
      type: 'skill_listing',
      mode,
      skills: skills.map(skill => ({ name: skill.name })),
    },
  )
}

export function createInvokedSkillAttachmentMessage(
  skills: LoadedSkill[],
): Message | null {
  if (skills.length === 0) {
    return null
  }

  return withSkillAttachment(
    createTextMessage(
      'user',
      wrapSystemReminder(buildPersistedInvokedSkillsReminderText(skills)),
    ),
    {
      type: 'invoked_skills',
      skills: skills.map(skill => ({ name: skill.name })),
    },
  )
}

export function createSingleInvokedSkillAttachmentMessage(
  skill: LoadedSkill,
): Message {
  return withSkillAttachment(
    createTextMessage(
      'user',
      wrapSystemReminder(buildInvokedSkillReminderText(skill)),
    ),
    {
      type: 'invoked_skills',
      skills: [{ name: skill.name }],
    },
  )
}
