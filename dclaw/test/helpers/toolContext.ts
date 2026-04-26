import type {
  PermissionMode,
  ToolContext,
  ToolRuntimeProfile,
} from '../../src/types/tool.js'
import { createInvokedSkillState } from '../../src/skills/state.js'
import type { LlmClient } from '../../src/llm/types.js'
import type { LlmProviderName } from '../../src/llm/providerNames.js'

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
    invokedSkills: createInvokedSkillState(),
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

export function createToolRuntimeProfile(input?: {
  supportsImageInput?: boolean
  supportsPdfInput?: boolean
  primaryProvider?: LlmProviderName
  primaryModel?: string
  imageFallback?: {
    client: LlmClient
    provider: LlmProviderName
    model?: string
  }
}): ToolRuntimeProfile {
  return {
    primary: {
      providerRef: 'primary-test',
      provider: input?.primaryProvider ?? 'openai',
      providerConfig: { provider: input?.primaryProvider ?? 'openai' } as never,
      model: input?.primaryModel ?? 'primary-test-model',
      modelSource: 'cli',
      modelCapabilities: {
        supportsImageInput: input?.supportsImageInput ?? true,
        supportsPdfInput: input?.supportsPdfInput ?? false,
      },
      client: {} as LlmClient,
    },
    ...(input?.imageFallback
      ? {
          imageFallback: {
            providerRef: 'fallback-test',
            provider: input.imageFallback.provider,
            providerConfig: { provider: input.imageFallback.provider } as never,
            model: input.imageFallback.model,
            modelSource: 'cli',
            modelCapabilities: {
              supportsImageInput: true,
              supportsPdfInput: false,
            },
            client: input.imageFallback.client,
          },
        }
      : {}),
  }
}
