import type {
  ToolContext,
  ToolResult,
  ToolValidationResult,
} from '../types/tool.js'

export interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  prompt(context: ToolContext): Promise<string> | string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  maxResultSizeChars: number
  call(input: I, context: ToolContext): Promise<ToolResult<O>>
  mapToolResult(result: ToolResult<O>): unknown
  validate(
    input: I,
    context: ToolContext,
  ): Promise<ToolValidationResult> | ToolValidationResult
  isEnabled(context: ToolContext): boolean
  isReadOnly(input: I): boolean
}

type DefaultableToolKeys =
  | 'prompt'
  | 'maxResultSizeChars'
  | 'mapToolResult'
  | 'validate'
  | 'isEnabled'
  | 'isReadOnly'

export type ToolDef<I = unknown, O = unknown> = Omit<
  Tool<I, O>,
  DefaultableToolKeys
> &
  Partial<Pick<Tool<I, O>, DefaultableToolKeys>>

const TOOL_DEFAULTS = {
  maxResultSizeChars: Number.POSITIVE_INFINITY,
  mapToolResult: <O>(result: ToolResult<O>): unknown => result.output,
  validate: (
    _input?: unknown,
    _context?: ToolContext,
  ): ToolValidationResult => ({ ok: true }),
  isEnabled: (_context?: ToolContext): boolean => true,
  isReadOnly: (_input?: unknown): boolean => false,
} satisfies Omit<Pick<Tool, DefaultableToolKeys>, 'prompt'>

type ToolDefaults = typeof TOOL_DEFAULTS & {
  prompt: (context: ToolContext) => Promise<string> | string
}
type AnyToolDef = ToolDef<any, any>
type BuiltTool<D> = Omit<D, DefaultableToolKeys> & {
  [K in DefaultableToolKeys]-?: K extends keyof D
    ? undefined extends D[K]
      ? ToolDefaults[K]
      : D[K]
    : ToolDefaults[K]
}

export function buildTool<D extends AnyToolDef>(definition: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,
    ...definition,
    prompt: definition.prompt ?? (() => definition.description),
  } as BuiltTool<D>
}
