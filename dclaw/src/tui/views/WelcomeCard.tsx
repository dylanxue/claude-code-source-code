import React from 'react'
import { Box, Text } from '../../ink/index.js'
import type { WelcomeCardData } from '../../cli/welcome.js'

type Props = {
  card: WelcomeCardData
}

export function WelcomeCard({ card }: Props) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Box>
        <Text color="cyan">{card.titlePrefix}</Text>
        <Text>{' '}</Text>
        <Text bold>{card.appName}</Text>
        <Text color="gray">{` (v${card.version})`}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'runtime:    '}</Text>
        <Text>{card.runtimeLabel}</Text>
        <Text color="cyan">{`   ${card.runtimeHint}`}</Text>
      </Box>
      <Box>
        <Text dimColor>{'directory:  '}</Text>
        <Text color="gray">{card.cwd}</Text>
      </Box>
    </Box>
  )
}
