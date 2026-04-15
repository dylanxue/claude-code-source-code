import type { ResumeCommand } from './types.js'

export async function runResume(command: ResumeCommand): Promise<void> {
  const lines = [
    'dclaw resume mode placeholder',
    `session id: ${command.sessionId}`,
    `cwd: ${command.options.cwd}`,
    '',
    'Next step: wire this command to session storage in phase 7.',
  ]

  process.stdout.write(lines.join('\n') + '\n')
}

