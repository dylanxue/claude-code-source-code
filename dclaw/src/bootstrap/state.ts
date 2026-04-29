let interactionTimeDirty = false
let scrollDraining = false
let scrollDrainTimer: ReturnType<typeof setTimeout> | undefined

const SCROLL_DRAIN_IDLE_MS = 150

export function updateLastInteractionTime(immediate = false): void {
  if (immediate) {
    flushInteractionTime()
    return
  }

  interactionTimeDirty = true
}

export function flushInteractionTime(): void {
  interactionTimeDirty = false
}

export function markScrollActivity(): void {
  scrollDraining = true
  if (scrollDrainTimer) {
    clearTimeout(scrollDrainTimer)
  }

  scrollDrainTimer = setTimeout(() => {
    scrollDraining = false
    scrollDrainTimer = undefined
  }, SCROLL_DRAIN_IDLE_MS)
  scrollDrainTimer.unref?.()
}

export function getIsScrollDraining(): boolean {
  return scrollDraining
}

export async function waitForScrollIdle(): Promise<void> {
  while (scrollDraining) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, SCROLL_DRAIN_IDLE_MS)
      timer.unref?.()
    })
  }
}

export function getIsInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}
