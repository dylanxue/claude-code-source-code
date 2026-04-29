import React, { type RefObject } from 'react'
import { Box } from '../../ink/index.js'
import ScrollBox, {
  type ScrollBoxHandle,
} from '../../ink/components/ScrollBox.js'

type Props = {
  children: React.ReactNode
  scrollRef: RefObject<ScrollBoxHandle | null>
}

export function TranscriptViewport({
  children,
  scrollRef,
}: Props): React.ReactNode {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <ScrollBox
        ref={scrollRef}
        flexDirection="column"
        flexGrow={1}
        stickyScroll
      >
        {children}
      </ScrollBox>
    </Box>
  )
}
