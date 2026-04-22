export type SkillSource = 'builtin' | 'project'

export type SkillDefinition = {
  name: string
  description: string
  source: SkillSource
  prompt: string
}

export type LoadedSkill = SkillDefinition & {
  path: string
}

export type SkillFrontmatter = {
  name: string
  description: string
}
