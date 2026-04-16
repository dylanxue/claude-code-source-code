import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFiles } from '../llm/env.js'
import { runDoctor } from './doctor.js'
import { runHeadless } from './headless.js'
import { runInteractive } from './interactive.js'
import { CliArgumentError, formatHelp, parseArgs } from './parseArgs.js'
import { runResume } from './resume.js'
import { readStdinIfPiped } from './stdio.js'
import type { ParsedCliCommand } from './types.js'

async function readVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkgPath = resolve(here, '../../package.json')
  const text = await readFile(pkgPath, 'utf8')
  const parsed = JSON.parse(text) as { version?: string }
  return parsed.version ?? '0.0.0'
}

async function resolvePrompt(command: ParsedCliCommand): Promise<ParsedCliCommand> {
  if (command.mode !== 'interactive' && command.mode !== 'print') {
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
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    loadEnvFiles(process.cwd())
    const parsed = parseArgs(argv)
    const command = await resolvePrompt(parsed)
    await dispatch(command)
  } catch (error) {
    if (error instanceof CliArgumentError) {
      if (error.message === 'HELP') {
        process.stdout.write(formatHelp() + '\n')
        return
      }
      if (error.message === 'VERSION') {
        process.stdout.write((await readVersion()) + '\n')
        return
      }
      process.stderr.write(`${error.message}\n\n${formatHelp()}\n`)
      process.exitCode = 1
      return
    }

    const message =
      error instanceof Error ? error.message : 'Unknown CLI failure'
    process.stderr.write(`CLI failed: ${message}\n`)
    process.exitCode = 1
  }
}

void main()
