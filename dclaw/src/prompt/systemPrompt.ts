import {
  getClaudeMdSection,
  getContextSection,
  getDoingTasksSection,
  getIntroSection,
  getPlanModeSection,
  getUserOverrideSection,
} from './sections.js'
import type { PromptContext } from './types.js'

export function buildSystemPrompt(context: PromptContext): string {
  const sections = [
    getIntroSection(),
    getDoingTasksSection(),
    getContextSection(context),
    getPlanModeSection(context),
    getClaudeMdSection(context),
    getUserOverrideSection(context),
  ].filter((section): section is string => Boolean(section))

  return sections.join('\n\n')
}
