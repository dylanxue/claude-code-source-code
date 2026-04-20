import { resolve } from 'node:path'
import { SUPPORTED_LLM_PROVIDERS } from '../llm/client.js'
import type { LlmProviderName } from '../llm/providerNames.js'
import type { PermissionMode } from '../types/tool.js'
import type { ParsedCliCommand } from './types.js'

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliArgumentError'
  }
}

function takeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const value = argv[index + 1]
  if (!value || value.startsWith('-')) {
    throw new CliArgumentError(`Missing value for ${flag}`)
  }
  return { value, nextIndex: index + 1 }
}

function parsePositiveIntegerArg(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) {
    throw new CliArgumentError(`${flag} must be a positive integer`)
  }

  const parsed = Number.parseInt(value, 10)
  if (parsed <= 0) {
    throw new CliArgumentError(`${flag} must be a positive integer`)
  }

  return parsed
}

export function parseArgs(argv: string[], baseCwd = process.cwd()): ParsedCliCommand {
  const args = [...argv]
  const options = {
    cwd: baseCwd,
    model: undefined as string | undefined,
    provider: undefined as LlmProviderName | undefined,
    outputFormat: 'text' as 'text' | 'sse',
    permissionMode: undefined as PermissionMode | undefined,
    maxIterations: undefined as number | undefined,
    stream: true,
    verbose: false,
    systemPrompt: undefined as string | undefined,
  }

  let mode: ParsedCliCommand['mode'] = 'interactive'
  let sessionId: string | undefined
  const positionals: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--print':
      case '-p':
        mode = 'print'
        break
      case '--doctor':
        mode = 'doctor'
        break
      case '--stream':
        options.stream = true
        break
      case '--no-stream':
        options.stream = false
        break
      case '--verbose':
      case '-d':
        options.verbose = true
        break
      case '--output-format': {
        const result = takeValue(args, i, arg)
        if (result.value !== 'text' && result.value !== 'sse') {
          throw new CliArgumentError(
            'Unsupported output format: ' +
              `${result.value}. Supported formats: text, sse`,
          )
        }
        options.outputFormat = result.value
        if (result.value === 'sse') {
          options.stream = true
        }
        i = result.nextIndex
        break
      }
      case '--model': {
        const result = takeValue(args, i, arg)
        options.model = result.value
        i = result.nextIndex
        break
      }
      case '--provider': {
        const result = takeValue(args, i, arg)
        if (
          !SUPPORTED_LLM_PROVIDERS.includes(
            result.value as (typeof SUPPORTED_LLM_PROVIDERS)[number],
          )
        ) {
          throw new CliArgumentError(
            `Unsupported provider: ${result.value}. Supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}`,
          )
        }
        options.provider = result.value as (typeof SUPPORTED_LLM_PROVIDERS)[number]
        i = result.nextIndex
        break
      }
      case '--system-prompt': {
        const result = takeValue(args, i, arg)
        options.systemPrompt = result.value
        i = result.nextIndex
        break
      }
      case '--permission-mode': {
        const result = takeValue(args, i, arg)
        if (
          result.value !== 'default' &&
          result.value !== 'accept-edits' &&
          result.value !== 'bypass-permissions' &&
          result.value !== 'plan'
        ) {
          throw new CliArgumentError(
            `Unsupported permission mode: ${result.value}. Supported modes: default, accept-edits, bypass-permissions, plan`,
          )
        }
        options.permissionMode = result.value
        i = result.nextIndex
        break
      }
      case '--max-iterations': {
        const result = takeValue(args, i, arg)
        options.maxIterations = parsePositiveIntegerArg(result.value, arg)
        i = result.nextIndex
        break
      }
      case '--cwd': {
        const result = takeValue(args, i, arg)
        options.cwd = resolve(result.value)
        i = result.nextIndex
        break
      }
      case 'resume':
        if (mode === 'print' || mode === 'doctor' || mode === 'history') {
          throw new CliArgumentError('resume cannot be combined with the current mode')
        }
        mode = 'resume'
        sessionId = args[i + 1]
        if (!sessionId || sessionId.startsWith('-')) {
          throw new CliArgumentError('Missing session ID for resume')
        }
        i += 1
        break
      case 'history':
        if (mode === 'print' || mode === 'doctor' || mode === 'resume') {
          throw new CliArgumentError('history cannot be combined with the current mode')
        }
        mode = 'history'
        break
      case '--help':
      case '-h':
        throw new CliArgumentError('HELP')
      case '--version':
      case '-v':
        throw new CliArgumentError('VERSION')
      default:
        if (arg.startsWith('-')) {
          throw new CliArgumentError(`Unknown option: ${arg}`)
        }
        positionals.push(arg)
    }
  }

  const prompt = positionals.length > 0 ? positionals.join(' ') : undefined

  if (mode === 'doctor') {
    return { mode, options }
  }
  if (mode === 'history') {
    if (positionals.length > 0) {
      throw new CliArgumentError('history does not accept a prompt')
    }
    return { mode, options }
  }
  if (mode === 'resume') {
    return { mode, sessionId: sessionId!, prompt, options }
  }
  if (mode === 'print') {
    return { mode, prompt, options }
  }

  return { mode: 'interactive', prompt, options }
}

export function formatHelp(): string {
  return [
    'dclaw',
    '',
    'Usage:',
    '  dclaw [prompt]',
    '  dclaw --print [prompt]',
    '  dclaw history',
    '  dclaw resume <session-id> [prompt]',
    '  dclaw --doctor',
    '',
    'Options:',
    '  -p, --print               Run in headless print mode',
    '  --doctor                  Show environment diagnostics',
    `  --provider <name>         Select provider (${SUPPORTED_LLM_PROVIDERS.join(', ')})`,
    '  --model <name>            Override the model name',
    '  --stream                  Stream assistant output as it arrives (default)',
    '  --no-stream               Disable streaming and wait for the final response',
    '  -d, --verbose             Show reasoning, content, and tool-call events',
    '  --output-format <format>  Output format for --print (text, sse)',
    '  --permission-mode <mode>  Select permission mode',
    '  --max-iterations <n>      Override the per-turn tool/LLM iteration cap',
    '  --system-prompt <text>    Append a one-off system prompt',
    '  --cwd <path>              Override working directory',
    '  -h, --help                Show help',
    '  -v, --version             Show version',
  ].join('\n')
}
