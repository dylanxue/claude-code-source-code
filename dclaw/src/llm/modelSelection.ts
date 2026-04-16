import { trimOrUndefined } from './providerUtils.js'

export type ModelSelectionSource = 'cli' | 'config' | 'none'

export function resolveModelSelection(
  modelOverride: string | undefined,
  defaultModel: string | undefined,
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
      source: 'config',
    }
  }

  return {
    model: undefined,
    source: 'none',
  }
}
