import { resolve } from 'node:path'
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

export function parseArgs(argv: string[], baseCwd = process.cwd()): ParsedCliCommand {
  const args = [...argv]
  const options = {
    cwd: baseCwd,
    model: undefined as string | undefined,
    provider: 'stub' as const,
    permissionMode: 'default' as
      | 'default'
      | 'accept-edits'
      | 'bypass-permissions'
      | 'plan',
    systemPrompt: undefined as string | undefined,
    verbose: false,
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
      case '--verbose':
      case '-d':
        options.verbose = true
        break
      case '--model': {
        const result = takeValue(args, i, arg)
        options.model = result.value
        i = result.nextIndex
        break
      }
      case '--provider': {
        const result = takeValue(args, i, arg)
        if (result.value !== 'stub') {
          throw new CliArgumentError(
            `Unsupported provider: ${result.value}. Supported providers: stub`,
          )
        }
        options.provider = result.value
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
      case '--cwd': {
        const result = takeValue(args, i, arg)
        options.cwd = resolve(result.value)
        i = result.nextIndex
        break
      }
      case 'resume':
        if (mode === 'print' || mode === 'doctor') {
          throw new CliArgumentError('resume cannot be combined with the current mode')
        }
        mode = 'resume'
        sessionId = args[i + 1]
        if (!sessionId || sessionId.startsWith('-')) {
          throw new CliArgumentError('Missing session ID for resume')
        }
        i += 1
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
  if (mode === 'resume') {
    return { mode, sessionId: sessionId!, options }
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
    '  dclaw resume <session-id>',
    '  dclaw --doctor',
    '',
    'Options:',
    '  -p, --print               Run in headless print mode',
    '  --doctor                  Show environment diagnostics',
    '  --provider <name>         Select provider (currently: stub)',
    '  --model <name>            Override the model name',
    '  --permission-mode <mode>  Select permission mode',
    '  --system-prompt <text>    Append a one-off system prompt',
    '  --cwd <path>              Override working directory',
    '  -d, --verbose             Enable verbose output',
    '  -h, --help                Show help',
    '  -v, --version             Show version',
  ].join('\n')
}
