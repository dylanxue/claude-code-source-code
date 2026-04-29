import React, { type RefObject } from 'react'
import { Box } from '../../ink/index.js'
import { AlternateScreen } from '../../ink/components/AlternateScreen.js'
import type { ScrollBoxHandle } from '../../ink/components/ScrollBox.js'
import { TranscriptScrollHandler } from '../components/TranscriptScrollHandler.js'
import { TranscriptViewport } from './TranscriptViewport.js'

type Props = {
  bottom: React.ReactNode
  fullscreen: boolean
  mouseTracking: boolean
  scrollRef: RefObject<ScrollBoxHandle | null>
  scrollable: React.ReactNode
}

export function TuiFullscreenLayout({
  bottom,
  fullscreen,
  mouseTracking,
  scrollRef,
  scrollable,
}: Props): React.ReactNode {
  if (!fullscreen) {
    return (
      <Box flexDirection="column">
        {scrollable}
        {bottom}
      </Box>
    )
  }

  return (
    <AlternateScreen mouseTracking={mouseTracking}>
      <TranscriptScrollHandler isActive scrollRef={scrollRef} />
      <Box flexDirection="column" height="100%" width="100%">
        <TranscriptViewport scrollRef={scrollRef}>{scrollable}</TranscriptViewport>
        <Box flexDirection="column" flexShrink={0} width="100%">
          {bottom}
        </Box>
      </Box>
    </AlternateScreen>
  )
}
