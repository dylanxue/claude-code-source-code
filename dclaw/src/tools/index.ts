import { bashTool } from './builtin/bash.js'
import { askUserQuestionTool } from './builtin/askUserQuestion.js'
import { agentTool } from './builtin/agent.js'
import { editTool } from './builtin/edit.js'
import { exitPlanModeTool } from './builtin/exitPlanMode.js'
import { globTool } from './builtin/glob.js'
import { grepTool } from './builtin/grep.js'
import { listLoadedSkillsTool } from './builtin/listLoadedSkills.js'
import { readFileTool } from './builtin/readFile.js'
import { reloadSkillsTool } from './builtin/reloadSkills.js'
import { skillTool } from './builtin/skill.js'
import { taskCreateTool } from './builtin/taskCreate.js'
import { taskGetTool } from './builtin/taskGet.js'
import { taskListTool } from './builtin/taskList.js'
import { taskUpdateTool } from './builtin/taskUpdate.js'
import { webFetchTool } from './builtin/webFetch.js'
import { writeTool } from './builtin/write.js'
import { ToolRegistry } from './registry.js'

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(bashTool)
  registry.register(globTool)
  registry.register(grepTool)
  registry.register(listLoadedSkillsTool)
  registry.register(readFileTool)
  registry.register(editTool)
  registry.register(writeTool)
  registry.register(webFetchTool)
  registry.register(skillTool)
  registry.register(reloadSkillsTool)
  registry.register(agentTool)
  registry.register(askUserQuestionTool)
  registry.register(exitPlanModeTool)
  registry.register(taskCreateTool)
  registry.register(taskListTool)
  registry.register(taskGetTool)
  registry.register(taskUpdateTool)
  return registry
}
