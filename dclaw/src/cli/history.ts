import { listSessionHistory } from '../session/history.js'
import type { HistoryCommand } from './types.js'

export async function runHistory(command: HistoryCommand): Promise<void> {
  const sessions = await listSessionHistory()
  const lines = ['dclaw history', '']

  if (sessions.length === 0) {
    lines.push('No sessions found yet.')
    process.stdout.write(lines.join('\n') + '\n')
    return
  }

  lines.push(`sessions: ${sessions.length}`)
  lines.push('')

  sessions.forEach((session, index) => {
    lines.push(
      `${index + 1}. ${session.meta.sessionId}  ${session.meta.mode}  ${session.meta.updatedAt}`,
    )
    lines.push(`   cwd: ${session.meta.cwd}`)
    lines.push(
      `   provider: ${session.meta.provider}${session.meta.model ? ` / ${session.meta.model}` : ''}`,
    )
    lines.push(`   messages: ${session.messageCount}`)

    if (session.lastUserText) {
      lines.push(`   last user: ${session.lastUserText}`)
    }
    if (session.lastAssistantText) {
      lines.push(`   last assistant: ${session.lastAssistantText}`)
    }
    if (session.lastBashSandboxMode) {
      lines.push(`   last bash sandbox: ${session.lastBashSandboxMode}`)
    }
    if (command.options.verbose) {
      lines.push(`   resume: dclaw resume ${session.meta.sessionId}`)
    }
    if (index < sessions.length - 1) {
      lines.push('')
    }
  })

  process.stdout.write(lines.join('\n') + '\n')
}
