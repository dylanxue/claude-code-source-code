import type {
  ToolContext,
  ToolResult,
  ToolValidationResult,
} from '../types/tool.js'

export interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  call(input: I, context: ToolContext): Promise<ToolResult<O>>
  validate?(
    input: I,
    context: ToolContext,
  ): Promise<ToolValidationResult> | ToolValidationResult
  isEnabled?(context: ToolContext): boolean
  isReadOnly?(input: I): boolean
}
