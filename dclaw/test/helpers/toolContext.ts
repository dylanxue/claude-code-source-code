import type { PermissionMode, ToolContext } from '../../src/types/tool.js'

export function createToolContext(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    cwd: process.cwd(),
    availableTools: [],
    permissionMode: 'default' satisfies PermissionMode,
    readState: new Map(),
    ...overrides,
  }
}
