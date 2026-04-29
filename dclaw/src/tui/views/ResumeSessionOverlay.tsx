import React from 'react'
import { Box, Text } from '../../ink/index.js'
import type { SessionHistoryEntry } from '../../session/history.js'

const MAX_VISIBLE_SESSIONS = 28
const CREATED_WIDTH = 18
const UPDATED_WIDTH = 18
const CONVERSATION_WIDTH = 86

type Props = {
  errorText?: string
  isLoading: boolean
  searchQuery: string
  selectedIndex: number
  sessions: SessionHistoryEntry[]
}

function getVisibleWindowStart(
  selectedIndex: number,
  itemCount: number,
): number {
  if (itemCount <= MAX_VISIBLE_SESSIONS) {
    return 0
  }

  return Math.min(
    Math.max(selectedIndex - MAX_VISIBLE_SESSIONS + 1, 0),
    itemCount - MAX_VISIBLE_SESSIONS,
  )
}

function getCharacterWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(
    char,
  )
    ? 2
    : 1
}

function getDisplayWidth(value: string): number {
  return [...value].reduce((width, char) => width + getCharacterWidth(char), 0)
}

function truncateToWidth(value: string, maxWidth: number): string {
  if (getDisplayWidth(value) <= maxWidth) {
    return value
  }

  const ellipsis = '...'
  const targetWidth = Math.max(maxWidth - getDisplayWidth(ellipsis), 0)
  let result = ''
  let width = 0
  for (const char of value) {
    const charWidth = getCharacterWidth(char)
    if (width + charWidth > targetWidth) {
      break
    }

    result += char
    width += charWidth
  }

  return `${result}${ellipsis}`
}

function padToWidth(value: string, width: number): string {
  const truncated = truncateToWidth(value, width)
  return `${truncated}${' '.repeat(Math.max(width - getDisplayWidth(truncated), 0))}`
}

function formatRelativeTime(value: string): string {
  const date = new Date(value)
  const elapsedMs = Date.now() - date.getTime()
  if (Number.isNaN(date.getTime()) || elapsedMs < 0) {
    return value
  }

  const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60_000))
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`
  }

  const elapsedHours = Math.round(elapsedMinutes / 60)
  if (elapsedHours < 48) {
    return `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`
  }

  const elapsedDays = Math.round(elapsedHours / 24)
  return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`
}

function formatSessionRow(
  session: SessionHistoryEntry,
  isSelected: boolean,
): string {
  const selector = isSelected ? '› ' : '  '
  return [
    selector,
    padToWidth(formatRelativeTime(session.meta.createdAt), CREATED_WIDTH),
    padToWidth(formatRelativeTime(session.meta.updatedAt), UPDATED_WIDTH),
    truncateToWidth(session.conversationTitle, CONVERSATION_WIDTH),
  ].join('')
}

export function ResumeSessionOverlay({
  errorText,
  isLoading,
  searchQuery,
  selectedIndex,
  sessions,
}: Props) {
  const windowStart = getVisibleWindowStart(selectedIndex, sessions.length)
  const visibleSessions = sessions.slice(
    windowStart,
    windowStart + MAX_VISIBLE_SESSIONS,
  )
  const header = [
    '  ',
    padToWidth('Created', CREATED_WIDTH),
    padToWidth('Updated', UPDATED_WIDTH),
    'Conversation',
  ].join('')

  return (
    <Box flexDirection="column" height="100%" paddingX={2} paddingY={1}>
      <Text>
        <Text bold color="cyan">Resume a previous session</Text>
        <Text dimColor>  Sort: </Text>
        <Text color="magenta">Updated</Text>
      </Text>
      <Text dimColor>{`Type to search${searchQuery ? `: ${searchQuery}` : ''}`}</Text>
      <Box marginTop={1} flexDirection="column">
        {isLoading ? (
          <Text dimColor>Loading recent sessions...</Text>
        ) : errorText ? (
          <Text color="red">{errorText}</Text>
        ) : (
          <>
            <Text bold wrap="truncate">{header}</Text>
            {sessions.length === 0 ? (
              <Text dimColor>
                {searchQuery ? 'No matching sessions.' : 'No saved sessions yet.'}
              </Text>
            ) : (
              visibleSessions.map((session, index) => {
                const absoluteIndex = windowStart + index
                const isSelected = absoluteIndex === selectedIndex

                return (
                  <Text
                    key={session.meta.sessionId}
                    color={isSelected ? 'cyan' : undefined}
                    wrap="truncate"
                  >
                    {formatSessionRow(session, isSelected)}
                  </Text>
                )
              })
            )}
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter to resume    esc to start new    ctrl+c to quit    ↑/↓ to browse</Text>
      </Box>
    </Box>
  )
}
