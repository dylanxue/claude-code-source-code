import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
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

  process.stdout.write(lines.join('\n') + '\n')
}
