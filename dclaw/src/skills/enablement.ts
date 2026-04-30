import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getProjectDir } from '../session/paths.js'
import type { LoadedSkill } from './types.js'

type SkillEnablementState = {
  disabledSkills?: unknown
}

export type SkillStatus = LoadedSkill & {
  enabled: boolean
}

function getSkillStatePath(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getProjectDir(workspaceRoot, env), 'skills-state.json')
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase()
}

function parseDisabledSkillNames(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set()
  }

  return new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(normalizeSkillName)
      .filter(entry => entry.length > 0),
  )
}

export async function loadDisabledSkillNames(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(
      await readFile(getSkillStatePath(workspaceRoot, env), 'utf8'),
    ) as SkillEnablementState
    return parseDisabledSkillNames(parsed.disabledSkills)
  } catch {
    return new Set()
  }
}

async function saveDisabledSkillNames(
  workspaceRoot: string,
  disabledSkillNames: Set<string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = getSkillStatePath(workspaceRoot, env)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    JSON.stringify(
      {
        disabledSkills: [...disabledSkillNames].sort((left, right) =>
          left.localeCompare(right),
        ),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )
}

export async function setSkillEnabled(
  workspaceRoot: string,
  skillName: string,
  enabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  if (!normalizedName) {
    throw new Error('Skill name is required.')
  }

  const disabledSkillNames = await loadDisabledSkillNames(workspaceRoot, env)
  if (enabled) {
    disabledSkillNames.delete(normalizedName)
  } else {
    disabledSkillNames.add(normalizedName)
  }
  await saveDisabledSkillNames(workspaceRoot, disabledSkillNames, env)
}

export function filterEnabledSkills(
  skills: LoadedSkill[],
  disabledSkillNames: Set<string>,
): LoadedSkill[] {
  return skills.filter(skill => !disabledSkillNames.has(normalizeSkillName(skill.name)))
}

export function getSkillStatuses(
  skills: LoadedSkill[],
  disabledSkillNames: Set<string>,
): SkillStatus[] {
  return skills.map(skill => ({
    ...skill,
    enabled: !disabledSkillNames.has(normalizeSkillName(skill.name)),
  }))
}
