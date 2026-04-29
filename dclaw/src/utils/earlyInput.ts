let earlyInputBuffer = ''

export function startCapturingEarlyInput(): void {
  earlyInputBuffer = ''
}

export function stopCapturingEarlyInput(): void {}

export function consumeEarlyInput(): string {
  const input = earlyInputBuffer.trim()
  earlyInputBuffer = ''
  return input
}

export function hasEarlyInput(): boolean {
  return earlyInputBuffer.trim().length > 0
}

export function seedEarlyInput(text: string): void {
  earlyInputBuffer = text
}

export function isCapturingEarlyInput(): boolean {
  return false
}
