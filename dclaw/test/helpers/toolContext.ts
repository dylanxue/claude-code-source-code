import type { PermissionMode, ToolContext } from '../../src/types/tool.js'

export function createToolContext(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const context: ToolContext = {
    sessionId: 'session-test',
    activeTurnId: 'turn-test',
    cwd: process.cwd(),
    availableTools: [],
    permissionMode: 'default' satisfies PermissionMode,
    readState: new Map(),
    ...overrides,
  }

  context.setPermissionMode ??= (permissionMode: PermissionMode) => {
    context.permissionMode = permissionMode
  }
  context.setPlanFilePath ??= (planFilePath: string | undefined) => {
    context.planFilePath = planFilePath
  }

  return context
}
