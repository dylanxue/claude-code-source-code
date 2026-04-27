import { resolve } from 'node:path'
import type { PermissionMode } from '../types/tool.js'
import type { InteractiveUiMode, ParsedCliCommand } from './types.js'

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
    runtime: undefined as string | undefined,
    permissionMode: undefined as PermissionMode | undefined,
    maxIterations: undefined as number | undefined,
    stream: true,
    systemPrompt: undefined as string | undefined,
    interactiveUi: 'auto' as InteractiveUiMode,
  }

  const setInteractiveUiMode = (
    nextMode: 'tui' | 'legacy-repl',
    flag: '--tui' | '--legacy-repl',
  ): void => {
    if (options.interactiveUi !== 'auto' && options.interactiveUi !== nextMode) {
      throw new CliArgumentError(
        `${flag} cannot be combined with ${
          options.interactiveUi === 'tui' ? '--tui' : '--legacy-repl'
        }`,
      )
    }

    options.interactiveUi = nextMode
  }

  let mode: ParsedCliCommand['mode'] = 'interactive'
  const positionals: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case 'exec':
        if (mode === 'doctor') {
          throw new CliArgumentError('exec cannot be combined with doctor')
        }
        mode = 'exec'
        break
      case '--print':
      case '-p':
        throw new CliArgumentError('Unknown option: --print')
      case '--doctor':
        throw new CliArgumentError('Unknown option: --doctor')
      case '--stream':
        options.stream = true
        break
      case '--no-stream':
        options.stream = false
        break
      case '--tui':
        setInteractiveUiMode('tui', '--tui')
        break
      case '--legacy-repl':
        setInteractiveUiMode('legacy-repl', '--legacy-repl')
        break
      case '--runtime': {
        const result = takeValue(args, i, arg)
        options.runtime = result.value
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
          result.value !== 'bypass-permissions'
        ) {
          throw new CliArgumentError(
            `Unsupported permission mode: ${result.value}. Supported modes: default, accept-edits, bypass-permissions`,
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
        throw new CliArgumentError('Unknown command: resume')
      case 'history':
        throw new CliArgumentError('Unknown command: history')
      case 'doctor':
        if (mode === 'exec') {
          throw new CliArgumentError('doctor cannot be combined with exec')
        }
        mode = 'doctor'
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
    if (positionals.length > 0) {
      throw new CliArgumentError('doctor does not accept a prompt')
    }
    return { mode, options }
  }
  if (mode === 'exec') {
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
    '  dclaw exec [prompt]',
    '  dclaw doctor',
    '',
    'Options:',
    '  --tui                     Start the experimental Ink + React TUI',
    '  --legacy-repl             Force the legacy readline REPL',
    '  --runtime <name>          Select runtime profile',
    '  --stream                  Stream assistant output as it arrives (default)',
    '  --no-stream               Disable streaming and wait for the final response',
    '  --permission-mode <mode>  Select permission mode (default, accept-edits, bypass-permissions)',
    '  --max-iterations <n>      Override the per-turn tool/LLM iteration cap',
    '  --system-prompt <text>    Append a one-off system prompt',
    '  --cwd <path>              Override working directory',
    '  -h, --help                Show help',
    '  -v, --version             Show version',
  ].join('\n')
}
