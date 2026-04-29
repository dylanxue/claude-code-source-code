export function canStartInteractiveTui(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): boolean {
  return Boolean(
    (input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY &&
      (output as NodeJS.WritableStream & { isTTY?: boolean }).isTTY,
  )
}
