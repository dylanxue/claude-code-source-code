export function logError(error: unknown): void {
  if (process.env.DEBUG !== '1' && process.env.DEBUG !== 'true') {
    return
  }

  const text = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`[dclaw-error] ${text}\n`)
}
