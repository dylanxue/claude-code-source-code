import { execFile } from 'node:child_process'
import { release, type as osType } from 'node:os'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_STATUS_TIMEOUT_MS = 3_000
const MAX_GIT_STATUS_LINES = 40
const MAX_GIT_STATUS_CHARS = 4_000

export type PromptEnvironmentContext = {
  currentDate: string
  platform: string
  shell: string
  osVersion: string
  isGitRepository: boolean
  gitStatus?: string
}

function getLocalDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function getShellName(shellPath: string | undefined): string {
  if (!shellPath) {
    return 'unknown'
  }

  return basename(shellPath) || shellPath
}

function truncateGitStatus(status: string): string {
  const trimmed = status.trim()
  if (trimmed.length === 0) {
    return trimmed
  }

  const lines = trimmed.split('\n')
  if (lines.length <= MAX_GIT_STATUS_LINES && trimmed.length <= MAX_GIT_STATUS_CHARS) {
    return trimmed
  }

  const keptLines = lines.slice(0, MAX_GIT_STATUS_LINES)
  const extraLines = Math.max(lines.length - keptLines.length, 0)
  let truncated = keptLines.join('\n')

  if (truncated.length > MAX_GIT_STATUS_CHARS) {
    truncated = truncated.slice(0, MAX_GIT_STATUS_CHARS).trimEnd()
  }

  if (extraLines > 0) {
    return `${truncated}\n... (${extraLines} more status lines)`
  }

  if (trimmed.length > truncated.length) {
    return `${truncated}\n... (status truncated)`
  }

  return truncated
}

async function getGitStatusSummary(cwd: string): Promise<{
  isGitRepository: boolean
  gitStatus?: string
}> {
  try {
    const { stdout: isGitStdout } = await execFileAsync(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      {
        cwd,
        timeout: GIT_STATUS_TIMEOUT_MS,
      },
    )

    if (isGitStdout.trim() !== 'true') {
      return { isGitRepository: false }
    }

    const { stdout: statusStdout } = await execFileAsync(
      'git',
      ['status', '--short', '--branch'],
      {
        cwd,
        timeout: GIT_STATUS_TIMEOUT_MS,
      },
    )

    const gitStatus = truncateGitStatus(statusStdout)
    return {
      isGitRepository: true,
      ...(gitStatus.length > 0 ? { gitStatus } : {}),
    }
  } catch {
    return { isGitRepository: false }
  }
}

export async function loadPromptEnvironmentContext(
  cwd: string,
): Promise<PromptEnvironmentContext> {
  const git = await getGitStatusSummary(cwd)

  return {
    currentDate: getLocalDateString(),
    platform: process.platform,
    shell: getShellName(process.env.SHELL),
    osVersion: `${osType()} ${release()}`,
    isGitRepository: git.isGitRepository,
    ...(git.gitStatus ? { gitStatus: git.gitStatus } : {}),
  }
}
