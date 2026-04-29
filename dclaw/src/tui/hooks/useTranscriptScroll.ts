import type { ScrollBoxHandle } from '../../ink/components/ScrollBox.js'

export type TranscriptScrollAction =
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'half-page-up'
  | 'half-page-down'
  | 'top'
  | 'bottom'

const WHEEL_ROWS = 3

export function getTranscriptScrollDelta(
  action: TranscriptScrollAction,
  viewportHeight: number,
): number | undefined {
  const pageRows = Math.max(1, viewportHeight - 1)
  const halfPageRows = Math.max(1, Math.floor(viewportHeight / 2))

  switch (action) {
    case 'line-up':
      return -WHEEL_ROWS
    case 'line-down':
      return WHEEL_ROWS
    case 'page-up':
      return -pageRows
    case 'page-down':
      return pageRows
    case 'half-page-up':
      return -halfPageRows
    case 'half-page-down':
      return halfPageRows
    case 'top':
    case 'bottom':
      return undefined
  }
}

export function applyTranscriptScrollAction(
  handle: ScrollBoxHandle | null,
  action: TranscriptScrollAction,
): boolean {
  if (!handle) {
    return false
  }

  if (action === 'top') {
    handle.scrollTo(0)
    return true
  }

  if (action === 'bottom') {
    handle.scrollToBottom()
    return true
  }

  const delta = getTranscriptScrollDelta(action, handle.getViewportHeight())
  if (delta === undefined) {
    return false
  }

  handle.scrollBy(delta)
  return true
}
