import type { InteractiveUiMode } from './types.js'

export function resolveInteractiveUiMode(
  mode: InteractiveUiMode | undefined,
): Exclude<InteractiveUiMode, 'auto'> {
  if (mode === 'tui' || mode === 'legacy-repl') {
    return mode
  }

  return 'legacy-repl'
}

export function canStartInteractiveTui(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): boolean {
  return Boolean(
    (input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY &&
      (output as NodeJS.WritableStream & { isTTY?: boolean }).isTTY,
  )
}
