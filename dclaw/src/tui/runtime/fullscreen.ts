import { spawnSync } from 'node:child_process'

let tmuxControlModeProbe: boolean | undefined

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function isFalsy(value: string | undefined): boolean {
  return value === '0' || value === 'false' || value === 'no' || value === 'off'
}

function isTmuxControlModeEnvHeuristic(): boolean {
  if (!process.env.TMUX) {
    return false
  }

  if (process.env.TERM_PROGRAM !== 'iTerm.app') {
    return false
  }

  const term = process.env.TERM ?? ''
  return !term.startsWith('screen') && !term.startsWith('tmux')
}

function probeTmuxControlMode(): boolean {
  if (isTmuxControlModeEnvHeuristic()) {
    return true
  }

  if (!process.env.TMUX) {
    return false
  }

  if (process.env.TERM_PROGRAM) {
    return false
  }

  try {
    const result = spawnSync(
      'tmux',
      ['display-message', '-p', '#{client_control_mode}'],
      { encoding: 'utf8', timeout: 2_000 },
    )
    return result.status === 0 && result.stdout.trim() === '1'
  } catch {
    return false
  }
}

export function isTmuxControlMode(): boolean {
  tmuxControlModeProbe ??= probeTmuxControlMode()
  return tmuxControlModeProbe
}

export function isTuiFullscreenEnabled(): boolean {
  const fullscreenFlag = process.env.DCLAW_TUI_FULLSCREEN

  if (isFalsy(fullscreenFlag)) {
    return false
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false
  }

  if (fullscreenFlag === 'auto') {
    return !isTmuxControlMode()
  }

  return isTruthy(fullscreenFlag)
}

export function isTuiMouseTrackingEnabled(): boolean {
  return !isTruthy(process.env.DCLAW_TUI_DISABLE_MOUSE)
}

export function resetTuiFullscreenProbeForTest(): void {
  tmuxControlModeProbe = undefined
}
