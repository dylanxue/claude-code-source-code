import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadResolvedLlmConfig } from '../llm/config.js'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import { getMemoryDir, getMemoryEntrypointPath } from '../memory/paths.js'
import {
  getProjectExecutionTaskBoardsDir,
  getProjectPlanBoardsDir,
  getProjectQueryTracesDir,
  getProjectSessionsDir,
} from '../session/paths.js'
import { buildConfigAwareEnvWithSources } from './configFile.js'
import {
  appendModelLimitLines,
  appendProxyConfigLines,
  appendVisionRuntimeLines,
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
    statusLine('runtime override', command.options.runtime ?? 'none'),
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
    statusLine('memory dir', getMemoryDir(cwd, configured.env)),
    statusLine('session dir', getProjectSessionsDir(cwd, configured.env)),
    statusLine('query trace dir', getProjectQueryTracesDir(cwd, configured.env)),
    statusLine('plan board dir', getProjectPlanBoardsDir(cwd, configured.env)),
    statusLine(
      'execution task board dir',
      getProjectExecutionTaskBoardsDir(cwd, configured.env),
    ),
    statusLine(
      'memory entrypoint',
      getMemoryEntrypointPath(cwd, configured.env),
    ),
    statusLine(
      'memory entrypoint exists',
      existsSync(getMemoryEntrypointPath(cwd, configured.env)) ? 'yes' : 'no',
    ),
  ]

  const llmConfig = await loadResolvedLlmConfig(cwd, configured.env)
  const runtime = resolveLlmRuntimeConfig(command.options, llmConfig, configured.env)
  lines.push(statusLine('runtime', runtime.runtimeName ?? 'stub'))
  lines.push(statusLine('runtime source', runtime.runtimeSource))
  lines.push(statusLine('provider ref', runtime.primary.providerRef))
  lines.push(statusLine('provider', runtime.primary.provider))

  if (runtime.primary.providerConfig.provider === 'anthropic') {
    const config = runtime.primary.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    appendProxyConfigLines(lines, config, configured.env)
    lines.push(statusLine('resolved model', runtime.primary.model ?? 'none'))
    lines.push(statusLine('model source', runtime.primary.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.primary.model) {
      appendModelLimitLines(lines, 'anthropic', runtime.primary.model, {
        env: configured.env,
        overrides: llmConfig.modelCatalogOverrides,
      })
    }
    appendVisionRuntimeLines(lines, runtime.imageFallback)
  }

  if (runtime.primary.providerConfig.provider === 'openai') {
    const config = runtime.primary.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    appendProxyConfigLines(lines, config, configured.env)
    lines.push(statusLine('api style', config.apiStyle))
    lines.push(statusLine('resolved model', runtime.primary.model ?? 'none'))
    lines.push(statusLine('model source', runtime.primary.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.primary.model) {
      appendModelLimitLines(lines, 'openai', runtime.primary.model, {
        env: configured.env,
        overrides: llmConfig.modelCatalogOverrides,
      })
    }
    appendVisionRuntimeLines(lines, runtime.imageFallback)
  }

  appendReliabilityConfigLines(lines, configured.env, key => configured.keySources[key])
  process.stdout.write(lines.join('\n') + '\n')
}
