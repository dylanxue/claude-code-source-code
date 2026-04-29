import { isEnvTruthy } from './envUtils.js'

export function isMouseClicksDisabled(): boolean {
  return (
    isEnvTruthy(process.env.DCLAW_TUI_DISABLE_MOUSE_CLICKS) ||
    isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MOUSE_CLICKS)
  )
}
