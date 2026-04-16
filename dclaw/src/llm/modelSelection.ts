import { trimOrUndefined } from './providerUtils.js'

export type ModelSelectionSource =
  | 'cli'
  | 'env'
  | 'user_config'
  | 'workspace_config'
  | 'none'

export function resolveModelSelection(
  modelOverride: string | undefined,
  defaultModel: string | undefined,
  defaultModelSource: Exclude<ModelSelectionSource, 'cli' | 'none'> = 'env',
): {
  model?: string
  source: ModelSelectionSource
} {
  const cliModel = trimOrUndefined(modelOverride)
  if (cliModel) {
    return {
      model: cliModel,
      source: 'cli',
    }
  }

  const configuredModel = trimOrUndefined(defaultModel)
  if (configuredModel) {
    return {
      model: configuredModel,
      source: defaultModelSource,
    }
  }

  return {
    model: undefined,
    source: 'none',
  }
}
