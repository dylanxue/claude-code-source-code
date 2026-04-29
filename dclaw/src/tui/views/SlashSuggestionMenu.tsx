import React from 'react'
import { Box, Text } from '../../ink/index.js'
import type { SlashSuggestion } from '../hooks/useSlashSuggestions.js'

type Props = {
  activeIndex: number
  suggestions: SlashSuggestion[]
}

const MAX_VISIBLE_MENU_ROWS = 8

function getVisibleWindowStart(
  activeIndex: number,
  itemCount: number,
): number {
  if (itemCount <= MAX_VISIBLE_MENU_ROWS) {
    return 0
  }

  return Math.min(
    Math.max(activeIndex - MAX_VISIBLE_MENU_ROWS + 1, 0),
    itemCount - MAX_VISIBLE_MENU_ROWS,
  )
}

export function SlashSuggestionMenu({ activeIndex, suggestions }: Props) {
  if (suggestions.length === 0) {
    return null
  }

  const windowStart = getVisibleWindowStart(activeIndex, suggestions.length)
  const visibleSuggestions = suggestions.slice(
    windowStart,
    windowStart + MAX_VISIBLE_MENU_ROWS,
  )

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {visibleSuggestions.map((suggestion, index) => {
        const absoluteIndex = windowStart + index
        const isActive = absoluteIndex === activeIndex
        const aliasText = suggestion.matchedAlias
          ? ` alias ${suggestion.matchedAlias}`
          : ''
        const hint = suggestion.argumentHint ? ` ${suggestion.argumentHint}` : ''

        return (
          <Text key={suggestion.name} color={isActive ? 'cyan' : undefined}>
            {`${isActive ? '›' : ' '} ${suggestion.name}${hint}  ${suggestion.displayName}${aliasText}`}
          </Text>
        )
      })}
    </Box>
  )
}
