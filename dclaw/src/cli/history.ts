import { listSessionHistory } from '../session/history.js'
import type { HistoryCommand } from './types.js'

type HistoryOutputOptions = {
  writeOutput?: (text: string) => void
}

function formatSubagentSummaryLine(
  session: Awaited<ReturnType<typeof listSessionHistory>>[number],
): string | null {
  const { subagents } = session
  if (subagents.count === 0) {
    return null
  }

  const parts = [
    `subagents: ${subagents.count}`,
    subagents.queuedCount > 0 ? `queued ${subagents.queuedCount}` : undefined,
    subagents.runningCount > 0 ? `running ${subagents.runningCount}` : undefined,
    subagents.completedCount > 0
      ? `completed ${subagents.completedCount}`
      : undefined,
    subagents.failedCount > 0 ? `failed ${subagents.failedCount}` : undefined,
    subagents.stoppedCount > 0 ? `stopped ${subagents.stoppedCount}` : undefined,
  ].filter((part): part is string => Boolean(part))

  return parts.join('  ')
}

export async function runHistory(
  command: HistoryCommand,
  options: HistoryOutputOptions = {},
): Promise<void> {
  const writeOutput =
    options.writeOutput ??
    ((text: string) => {
      process.stdout.write(text)
    })
  const sessions = await listSessionHistory(command.options.cwd)
  const lines = ['dclaw history', '']

  if (sessions.length === 0) {
    lines.push('No sessions found yet.')
    writeOutput(lines.join('\n') + '\n')
    return
  }

  lines.push(`sessions: ${sessions.length}`)
  lines.push('')

  sessions.forEach((session, index) => {
    lines.push(
      `${index + 1}. ${session.meta.sessionId}  ${session.meta.mode}  ${session.meta.updatedAt}`,
    )
    lines.push(`   cwd: ${session.meta.cwd}`)
    lines.push(`   runtime: ${session.meta.runtimeName ?? 'stub'}`)
    lines.push(
      `   provider/model: ${session.meta.provider}${session.meta.model ? ` / ${session.meta.model}` : ''}`,
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
    if (session.persistedToolResultCount > 0) {
      lines.push(
        `   persisted tool results: ${session.persistedToolResultCount}`,
      )
      if (session.lastPersistedToolResultPath) {
        lines.push(
          `   last persisted tool result: ${session.lastPersistedToolResultPath}`,
        )
      }
    }
    if (session.compactBoundaryCount > 0) {
      lines.push(`   compact boundaries: ${session.compactBoundaryCount}`)
      if (session.lastCompactBoundaryLabel) {
        lines.push(`   last compact boundary: ${session.lastCompactBoundaryLabel}`)
      }
    }
    session.planningSummary.forEach(line => {
      lines.push(`   ${line}`)
    })
    const subagentLine = formatSubagentSummaryLine(session)
    if (subagentLine) {
      lines.push(`   ${subagentLine}`)
      if (session.subagents.lastStatus && session.subagents.lastTask) {
        lines.push(
          `   last subagent: ${session.subagents.lastStatus}  ${session.subagents.lastTask}`,
        )
      }
      if (session.subagents.lastTracePath) {
        lines.push(`   last subagent trace: ${session.subagents.lastTracePath}`)
      }
    }
    if (index < sessions.length - 1) {
      lines.push('')
    }
  })

  writeOutput(lines.join('\n') + '\n')
}
