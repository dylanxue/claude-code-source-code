import { pathToFileURL } from 'node:url'
import { loadEnvFiles } from '../llm/env.js'
import { getCliErrorOutput } from './errorFormatting.js'
import { runDoctor } from './doctor.js'
import { runHeadless } from './headless.js'
import { runHistory } from './history.js'
import { runInteractive } from './interactive.js'
import { CliArgumentError, formatHelp, parseArgs } from './parseArgs.js'
import { runResume } from './resume.js'
import { readStdinIfPiped } from './stdio.js'
import type { ParsedCliCommand } from './types.js'
import { readCliVersion } from './version.js'

async function resolvePrompt(command: ParsedCliCommand): Promise<ParsedCliCommand> {
  if (
    command.mode !== 'interactive' &&
    command.mode !== 'print' &&
    command.mode !== 'resume'
  ) {
    return command
  }

  if (command.prompt) {
    return command
  }

  const stdinPrompt = await readStdinIfPiped()
  if (!stdinPrompt) {
    return command
  }

  return { ...command, prompt: stdinPrompt }
}

async function dispatch(command: ParsedCliCommand): Promise<void> {
  switch (command.mode) {
    case 'interactive':
      await runInteractive(command)
      return
    case 'print':
      await runHeadless(command)
      return
    case 'doctor':
      await runDoctor(command)
      return
    case 'resume':
      await runResume(command)
      return
    case 'history':
      await runHistory(command)
      return
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let command: ParsedCliCommand | undefined

  try {
    loadEnvFiles(process.cwd())
    const parsed = parseArgs(argv)
    command = await resolvePrompt(parsed)
    await dispatch(command)
  } catch (error) {
    if (error instanceof CliArgumentError) {
      if (error.message === 'HELP') {
        process.stdout.write(formatHelp() + '\n')
        return
      }
      if (error.message === 'VERSION') {
        process.stdout.write((await readCliVersion()) + '\n')
        return
      }
      process.stderr.write(`${error.message}\n\n${formatHelp()}\n`)
      process.exitCode = 1
      return
    }

    const output = getCliErrorOutput(command, error)
    if (output.stream === 'stdout') {
      process.stdout.write(output.text)
    } else {
      process.stderr.write(output.text)
    }
    process.exitCode = 1
  }
}

function isDirectExecution(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) {
    return false
  }

  return import.meta.url === pathToFileURL(argv1).href
}

if (isDirectExecution()) {
  void main()
}
