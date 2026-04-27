export function formatElapsedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export function formatActiveTurnStatusText(durationMs: number): string {
  return `Working (${formatElapsedDuration(durationMs)}, Esc to cancel)`
}

export function formatCompletedTurnStatusText(durationMs: number): string {
  return `Worked for ${formatElapsedDuration(durationMs)}`
}
