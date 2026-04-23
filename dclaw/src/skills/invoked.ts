import { getTextContent, type Message } from '../types/message.js'
import type { LoadedSkill } from './types.js'
import { parseInvokedSkillReminderText } from './prompt.js'

export type InvokedSkill = LoadedSkill & {
  invokedAt: number
}

export type InvokedSkillState = Map<string, InvokedSkill>

function normalizeSkillName(name: string): string {
  return name.trim()
}

function getInvokedAt(createdAt: string | undefined, fallback: number): number {
  if (!createdAt) {
    return fallback
  }

  const parsed = Date.parse(createdAt)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function createInvokedSkillState(
  skills: InvokedSkill[] = [],
): InvokedSkillState {
  const state: InvokedSkillState = new Map()
  replaceInvokedSkills(state, skills)
  return state
}

export function replaceInvokedSkills(
  state: InvokedSkillState | undefined,
  skills: InvokedSkill[],
): void {
  if (!state) {
    return
  }

  state.clear()
  for (const skill of skills) {
    state.set(normalizeSkillName(skill.name), {
      ...skill,
    })
  }
}

export function recordInvokedSkill(
  state: InvokedSkillState | undefined,
  skill: LoadedSkill,
  invokedAt: number = Date.now(),
): void {
  if (!state) {
    return
  }

  state.set(normalizeSkillName(skill.name), {
    ...skill,
    invokedAt,
  })
}

export function listInvokedSkills(
  state: InvokedSkillState | undefined,
): InvokedSkill[] {
  if (!state || state.size === 0) {
    return []
  }

  return [...state.values()].sort((left, right) => right.invokedAt - left.invokedAt)
}

export function restoreInvokedSkillsFromMessages(
  messages: Message[],
  state: InvokedSkillState | undefined,
): void {
  if (!state) {
    return
  }

  state.clear()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    const skill = parseInvokedSkillReminderText(getTextContent(message))
    if (!skill) {
      continue
    }

    recordInvokedSkill(
      state,
      skill,
      getInvokedAt(message.createdAt, index),
    )
  }
}
