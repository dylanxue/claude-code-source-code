import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getModelLimitsConfigPath,
  resolveModelLimits,
} from '../llm/modelLimits.js'
import { resolveAnthropicConfig } from '../llm/providers/anthropic.js'
import { resolveOpenAiConfig } from '../llm/providers/openai.js'
import type { DoctorCommand } from './types.js'

function statusLine(label: string, value: string): string {
  return `${label.padEnd(18)} ${value}`
}

export async function runDoctor(command: DoctorCommand): Promise<void> {
  const cwd = resolve(command.options.cwd)
  const lines = [
    'dclaw doctor',
    '',
    statusLine('node', process.version),
    statusLine('platform', process.platform),
    statusLine('cwd', cwd),
    statusLine('cwd exists', existsSync(cwd) ? 'yes' : 'no'),
    statusLine('mode', 'doctor'),
    statusLine('provider', command.options.provider),
    statusLine('model override', command.options.model ?? 'none'),
    statusLine(
      'system prompt',
      command.options.systemPrompt ? 'provided' : 'none',
    ),
  ]

  if (command.options.provider === 'anthropic') {
    const config = resolveAnthropicConfig()
    const resolvedModel = command.options.model ?? config.defaultModel
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('default model', config.defaultModel ?? 'none'))
    lines.push(statusLine('resolved model', resolvedModel ?? 'none'))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (resolvedModel) {
      appendModelLimits(lines, 'anthropic', resolvedModel)
    }
  }

  if (command.options.provider === 'openai') {
    const config = resolveOpenAiConfig()
    const resolvedModel = command.options.model ?? config.defaultModel
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('api style', config.apiStyle))
    lines.push(statusLine('default model', config.defaultModel ?? 'none'))
    lines.push(statusLine('resolved model', resolvedModel ?? 'none'))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (resolvedModel) {
      appendModelLimits(lines, 'openai', resolvedModel)
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
