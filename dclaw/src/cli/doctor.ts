import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getModelLimitsConfigPath,
  resolveModelLimits,
} from '../llm/modelLimits.js'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import { buildConfigAwareEnvWithSources } from './configFile.js'
import { resolvePermissionMode } from './permissionModeConfig.js'
import type { DoctorCommand } from './types.js'

function statusLine(label: string, value: string): string {
  return `${label.padEnd(18)} ${value}`
}

export async function runDoctor(command: DoctorCommand): Promise<void> {
  const cwd = resolve(command.options.cwd)
  const configured = await buildConfigAwareEnvWithSources(cwd)
  const resolvedPermissionMode = await resolvePermissionMode({
    cwd,
    permissionMode: command.options.permissionMode,
  }, configured.env)
  const lines = [
    'dclaw doctor',
    '',
    statusLine('node', process.version),
    statusLine('platform', process.platform),
    statusLine('cwd', cwd),
    statusLine('cwd exists', existsSync(cwd) ? 'yes' : 'no'),
    statusLine('mode', 'doctor'),
    statusLine('provider override', command.options.provider ?? 'none'),
    statusLine('model override', command.options.model ?? 'none'),
    statusLine('permission override', command.options.permissionMode ?? 'none'),
    statusLine('permission mode', resolvedPermissionMode.permissionMode),
    statusLine('permission source', resolvedPermissionMode.permissionModeSource),
    statusLine(
      'system prompt',
      command.options.systemPrompt ? 'provided' : 'none',
    ),
  ]

  const runtime = resolveLlmRuntimeConfig(
    command.options,
    configured.env,
    key => configured.keySources[key],
  )
  lines.push(statusLine('provider', runtime.provider))
  lines.push(statusLine('provider source', runtime.providerSource))

  if (runtime.providerConfig.provider === 'anthropic') {
    const config = runtime.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('default model', config.defaultModel ?? 'none'))
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', runtime.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.model) {
      appendModelLimits(lines, 'anthropic', runtime.model)
    }
  }

  if (runtime.providerConfig.provider === 'openai') {
    const config = runtime.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('api style', config.apiStyle))
    lines.push(statusLine('default model', config.defaultModel ?? 'none'))
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', runtime.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.model) {
      appendModelLimits(lines, 'openai', runtime.model)
    }
  }

  process.stdout.write(lines.join('\n') + '\n')
}

function getLimitsConfigStatus(): string {
  const filePath = getModelLimitsConfigPath()
  return existsSync(filePath) ? filePath : `not found (${filePath})`
}

function appendModelLimits(
  lines: string[],
  provider: 'anthropic' | 'openai',
  model: string,
): void {
  const limits = resolveModelLimits(provider, model)
  lines.push(statusLine('context window', String(limits.contextWindow)))
  lines.push(statusLine('max output', String(limits.maxOutputTokens)))
  lines.push(
    statusLine('max output cap', String(limits.maxOutputTokensUpperLimit)),
  )
}
