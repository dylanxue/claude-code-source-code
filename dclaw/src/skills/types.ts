export type SkillSource = 'builtin' | 'project'
export type SkillExecutionContext = 'inline' | 'fork'

export type SkillDefinition = {
  name: string
  description: string
  source: SkillSource
  prompt: string
  context?: SkillExecutionContext
}

export type LoadedSkill = SkillDefinition & {
  path: string
}

export type SkillFrontmatter = {
  name: string
  description: string
  context?: SkillExecutionContext
}
