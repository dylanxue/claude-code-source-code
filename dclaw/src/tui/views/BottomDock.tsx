import React from 'react'
import { Box, Text } from 'ink'

type Props = {
  cwd: string
  inputValue: string
  isBusy: boolean
  permissionLabel: string
  placeholder: string
  queueCount: number
  runtimeLabel: string
}

export function BottomDock({
  cwd,
  inputValue,
  isBusy,
  permissionLabel,
  placeholder,
  queueCount,
  runtimeLabel,
}: Props) {
  const metaParts = [
    runtimeLabel,
    permissionLabel,
    cwd,
    ...(isBusy ? ['busy'] : []),
    ...(queueCount > 0 ? [`queued:${queueCount}`] : []),
  ]

  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      <Box backgroundColor="gray" paddingX={1}>
        <Text color={inputValue.length > 0 ? 'black' : 'gray'}>
          {`› ${inputValue.length > 0 ? `${inputValue}\u2588` : placeholder}`}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{metaParts.join(' · ')}</Text>
      </Box>
    </Box>
  )
}
