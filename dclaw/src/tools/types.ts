import type {
  ToolContext,
  ToolResult,
  ToolValidationResult,
} from '../types/tool.js'

export interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
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
  mapToolResult: <O>(result: ToolResult<O>): unknown => result.output,
  validate: (
    _input?: unknown,
    _context?: ToolContext,
  ): ToolValidationResult => ({ ok: true }),
  isEnabled: (_context?: ToolContext): boolean => true,
  isReadOnly: (_input?: unknown): boolean => false,
} satisfies Pick<Tool, DefaultableToolKeys>

type ToolDefaults = typeof TOOL_DEFAULTS
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
  } as BuiltTool<D>
}
