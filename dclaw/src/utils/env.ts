import { isEnvTruthy } from './envUtils.js'

type Platform = 'win32' | 'darwin' | 'linux'

function isSSHSession(): boolean {
  return Boolean(
    process.env.SSH_CONNECTION ||
      process.env.SSH_CLIENT ||
      process.env.SSH_TTY,
  )
}

function detectTerminal(): string | null {
  if (process.env.CURSOR_TRACE_ID) {
    return 'cursor'
  }

  if (process.env.TERM === 'xterm-ghostty') {
    return 'ghostty'
  }

  if (process.env.TERM?.includes('kitty') || process.env.KITTY_WINDOW_ID) {
    return 'kitty'
  }

  if (process.env.TERM_PROGRAM) {
    return process.env.TERM_PROGRAM
  }

  if (process.env.TMUX) {
    return 'tmux'
  }

  if (process.env.STY) {
    return 'screen'
  }

  if (process.env.WT_SESSION) {
    return 'windows-terminal'
  }

  if (process.env.TERM) {
    if (process.env.TERM.includes('alacritty')) {
      return 'alacritty'
    }

    return process.env.TERM
  }

  if (!process.stdout.isTTY) {
    return 'non-interactive'
  }

  return null
}

export const env = {
  arch: process.arch,
  isCI: isEnvTruthy(process.env.CI),
  isSSH: isSSHSession,
  nodeVersion: process.version,
  platform: (['win32', 'darwin'].includes(process.platform)
    ? process.platform
    : 'linux') as Platform,
  terminal: detectTerminal(),
}
