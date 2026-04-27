import React from 'react'
import { Box, Text } from 'ink'
import type { StructuredCardEntry, TranscriptItem } from '../state/index.js'

type Props = {
  activeStatusText?: string
  entries: TranscriptItem[]
}

type MultilineTextBlockProps = {
  text: string
  prefix: string
  dimColor?: boolean
}

function MultilineTextBlock({
  text,
  prefix,
  dimColor = false,
}: MultilineTextBlockProps) {
  const lines = text.split('\n')

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${prefix}-${index}`} dimColor={dimColor}>
          {index === 0 ? `${prefix}${line}` : `  ${line}`}
        </Text>
      ))}
    </Box>
  )
}

function StructuredCard({ title, entries }: {
  title: string
  entries: StructuredCardEntry[]
}) {
  const rowLabelWidth = entries.reduce((maxWidth, entry) => {
    if (entry.kind !== 'row') {
      return maxWidth
    }

    return Math.max(maxWidth, entry.label.length)
  }, 0)

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text bold>{title}</Text>
      {entries.length > 0 ? <Box marginBottom={1} /> : null}
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') {
          return <Box key={`sep-${index}`} marginBottom={1} />
        }

        if (entry.kind === 'text') {
          return (
            <Text key={`text-${index}`} dimColor>
              {entry.text}
            </Text>
          )
        }

        return (
          <Box key={`row-${index}`}>
            <Text dimColor>{`${entry.label.padEnd(rowLabelWidth)}  `}</Text>
            <Text>{entry.value}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function TimeSeparator({ text }: { text: string }) {
  return (
    <Text dimColor>{`─ ${text} ─`}</Text>
  )
}

export function TranscriptPane({ activeStatusText, entries }: Props) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingTop={1}>
      {entries.map(entry => (
        <Box key={entry.id} flexDirection="column" marginBottom={1}>
          {entry.kind === 'user_prompt' ? (
            <Box backgroundColor="gray" paddingX={1}>
              <Text>{`› ${entry.text}`}</Text>
            </Box>
          ) : entry.kind === 'user_command' ? (
            <Text color="cyan">{entry.text}</Text>
          ) : entry.kind === 'activity_group' ? (
            <Box flexDirection="column">
              <Text>{`• ${entry.title}`}</Text>
              {entry.entries.map(activityEntry => (
                <Box key={activityEntry.toolUseId} paddingLeft={2}>
                  <Text>{`└ ${activityEntry.text}`}</Text>
                </Box>
              ))}
            </Box>
          ) : entry.kind === 'structured_card' ? (
            <StructuredCard title={entry.title} entries={entry.entries} />
          ) : entry.kind === 'time_separator' ? (
            <TimeSeparator text={entry.text} />
          ) : entry.kind === 'system' ? (
            <MultilineTextBlock dimColor prefix="" text={entry.text} />
          ) : (
            <MultilineTextBlock prefix="• " text={entry.text} />
          )}
        </Box>
      ))}
      {activeStatusText ? (
        <Box marginBottom={1}>
          <MultilineTextBlock
            dimColor
            prefix="• "
            text={activeStatusText}
          />
        </Box>
      ) : null}
    </Box>
  )
}
