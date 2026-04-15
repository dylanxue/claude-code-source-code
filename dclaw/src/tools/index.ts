import { bashTool } from './builtin/bash.js'
import { askUserQuestionTool } from './builtin/askUserQuestion.js'
import { editTool } from './builtin/edit.js'
import { globTool } from './builtin/glob.js'
import { grepTool } from './builtin/grep.js'
import { readFileTool } from './builtin/readFile.js'
import { webFetchTool } from './builtin/webFetch.js'
import { writeTool } from './builtin/write.js'
import { ToolRegistry } from './registry.js'

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(bashTool)
  registry.register(globTool)
  registry.register(grepTool)
  registry.register(readFileTool)
  registry.register(editTool)
  registry.register(writeTool)
  registry.register(webFetchTool)
  registry.register(askUserQuestionTool)
  return registry
}
