import React from 'react'
import { Box, Text } from 'ink'
import type { BottomSheetState } from '../hooks/useBottomSheet.js'

type Props = {
  sheet: BottomSheetState
}

const MAX_VISIBLE_MENU_ROWS = 8

function getVisibleWindowStart(
  selectedIndex: number,
  itemCount: number,
): number {
  if (itemCount <= MAX_VISIBLE_MENU_ROWS) {
    return 0
  }

  return Math.min(
    Math.max(selectedIndex - MAX_VISIBLE_MENU_ROWS + 1, 0),
    itemCount - MAX_VISIBLE_MENU_ROWS,
  )
}

export function BottomSheet({ sheet }: Props) {
  const windowStart = getVisibleWindowStart(
    sheet.selectedIndex,
    sheet.options.length,
  )
  const visibleOptions = sheet.options.slice(
    windowStart,
    windowStart + MAX_VISIBLE_MENU_ROWS,
  )

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>{sheet.title}</Text>
      <Text dimColor>{sheet.description}</Text>
      <Box height={1} />
      {visibleOptions.map((option, index) => {
        const absoluteIndex = windowStart + index
        const isActive = absoluteIndex === sheet.selectedIndex
        const description = option.description ? `  ${option.description}` : ''
        return (
          <Text key={option.value} color={isActive ? 'cyan' : undefined}>
            {`${isActive ? '›' : ' '} ${option.label}${description}`}
          </Text>
        )
      })}
    </Box>
  )
}
