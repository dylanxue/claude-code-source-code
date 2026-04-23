import {
  getCurrentDateSection,
  getContextSection,
  getDoingTasksSection,
  getEnvironmentSection,
  getGitStatusSection,
  getIntroSection,
  getLanguageSection,
  getMemorySection,
  getPlanModeSection,
  getUserOverrideSection,
} from './sections.js'
import type { PromptContext } from './types.js'

export function buildSystemPrompt(context: PromptContext): string {
  const sections = [
    getIntroSection(),
    getDoingTasksSection(),
    getLanguageSection(),
    getContextSection(context),
    getCurrentDateSection(context),
    getEnvironmentSection(context),
    getGitStatusSection(context),
    getPlanModeSection(context),
    getMemorySection(context),
    getUserOverrideSection(context),
  ].filter((section): section is string => Boolean(section))

  return sections.join('\n\n')
}
