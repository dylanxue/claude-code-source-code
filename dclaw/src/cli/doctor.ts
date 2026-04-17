import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import { buildConfigAwareEnvWithSources } from './configFile.js'
import {
  appendModelLimitLines,
  appendReliabilityConfigLines,
  getLimitsConfigStatus,
  statusLine,
} from './diagnostics.js'
import { resolveMaxIterations } from './maxIterationsConfig.js'
import { resolvePermissionMode } from './permissionModeConfig.js'
import type { DoctorCommand } from './types.js'

export async function runDoctor(command: DoctorCommand): Promise<void> {
  const cwd = resolve(command.options.cwd)
  const configured = await buildConfigAwareEnvWithSources(cwd)
  const resolvedPermissionMode = await resolvePermissionMode({
    cwd,
    permissionMode: command.options.permissionMode,
  }, configured.env)
  const resolvedMaxIterations = await resolveMaxIterations(
    {
      cwd,
      maxIterations: command.options.maxIterations,
    },
    configured.env,
    key => configured.keySources[key],
  )
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
      'max iterations',
      `${resolvedMaxIterations.maxIterations} (${resolvedMaxIterations.maxIterationsSource})`,
    ),
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
      appendModelLimitLines(lines, 'anthropic', runtime.model)
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
      appendModelLimitLines(lines, 'openai', runtime.model)
    }
  }

  appendReliabilityConfigLines(lines, configured.env, key => configured.keySources[key])
  process.stdout.write(lines.join('\n') + '\n')
}
