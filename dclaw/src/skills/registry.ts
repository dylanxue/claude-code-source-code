import type { LoadedSkill } from './types.js'

export class SkillRegistry {
  private readonly skills = new Map<string, LoadedSkill>()

  constructor(skills: LoadedSkill[] = []) {
    skills.forEach(skill => {
      this.register(skill)
    })
  }

  register(skill: LoadedSkill): void {
    this.skills.set(skill.name, skill)
  }

  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name)
  }

  list(): LoadedSkill[] {
    return [...this.skills.values()]
  }
}

export function createSkillRegistry(skills: LoadedSkill[] = []): SkillRegistry {
  return new SkillRegistry(skills)
}
