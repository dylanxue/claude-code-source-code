import React from 'react'
import { Text } from '../../ink/index.js'

type Props = {
  children: string
}

export function SectionTitle({ children }: Props) {
  return (
    <Text bold color="cyan">
      {children}
    </Text>
  )
}
