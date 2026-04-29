export type DebugLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

export function isDebugMode(): boolean {
  return process.env.DEBUG === '1' || process.env.DEBUG === 'true'
}

export function isDebugToStdErr(): boolean {
  return process.argv.includes('--debug-to-stderr')
}

export function logForDebugging(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isDebugMode() && !isDebugToStdErr()) {
    return
  }

  const suffix = data ? ` ${JSON.stringify(data)}` : ''
  process.stderr.write(`[dclaw-debug] ${message}${suffix}\n`)
}
