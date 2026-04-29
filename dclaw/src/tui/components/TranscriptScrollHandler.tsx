import React, { type RefObject } from 'react'
import { type Key, useInput } from '../../ink/index.js'
import type { ScrollBoxHandle } from '../../ink/components/ScrollBox.js'
import {
  applyTranscriptScrollAction,
  type TranscriptScrollAction,
} from '../hooks/useTranscriptScroll.js'

type Props = {
  isActive: boolean
  scrollRef: RefObject<ScrollBoxHandle | null>
}

function getScrollAction(
  input: string,
  key: Key,
): TranscriptScrollAction | undefined {
  if (key.wheelUp) {
    return 'line-up'
  }

  if (key.wheelDown) {
    return 'line-down'
  }

  if (key.pageUp) {
    return 'page-up'
  }

  if (key.pageDown) {
    return 'page-down'
  }

  if (key.home) {
    return 'top'
  }

  if (key.end) {
    return 'bottom'
  }

  if (key.ctrl && input === 'u') {
    return 'half-page-up'
  }

  if (key.ctrl && input === 'd') {
    return 'half-page-down'
  }

  return undefined
}

export function TranscriptScrollHandler({
  isActive,
  scrollRef,
}: Props): React.ReactNode {
  useInput(
    (input, key, event) => {
      const action = getScrollAction(input, key)
      if (!action) {
        return
      }

      if (applyTranscriptScrollAction(scrollRef.current, action)) {
        event.stopImmediatePropagation()
      }
    },
    { isActive },
  )

  return null
}
