import React from 'react'
import { Box, Text } from '../../ink/index.js'
import { formatPathForDisplay } from '../../cli/welcome.js'
import type { BottomSheetState } from '../hooks/useBottomSheet.js'
import type { SlashSuggestion } from '../hooks/useSlashSuggestions.js'
import { BottomSheet } from './BottomSheet.js'
import { MemoryMenu, type MemoryMenuState } from './MemoryMenu.js'
import { QuestionDialog, type QuestionDialogState } from './QuestionDialog.js'
import { SkillsMenu, type SkillsMenuState } from './SkillsMenu.js'
import { SlashSuggestionMenu } from './SlashSuggestionMenu.js'

type Props = {
  activeSuggestionIndex: number
  bottomSheet?: BottomSheetState
  cursorIndex: number
  cwd: string
  inputValue: string
  isBusy: boolean
  memoryMenu?: MemoryMenuState
  permissionLabel: string
  placeholder: string
  queuedPrompts: string[]
  questionDialog?: QuestionDialogState
  runtimeLabel: string
  skillsMenu?: SkillsMenuState
  slashSuggestions: SlashSuggestion[]
}

export function formatPermissionStatusLabel(permissionLabel: string): string {
  return permissionLabel === 'plan'
    ? 'PLAN MODE (Shift+Tab to exit plan)'
    : permissionLabel
}

export function BottomDock({
  activeSuggestionIndex,
  bottomSheet,
  cursorIndex,
  cwd,
  inputValue,
  isBusy,
  memoryMenu,
  permissionLabel,
  placeholder,
  queuedPrompts,
  questionDialog,
  runtimeLabel,
  skillsMenu,
  slashSuggestions,
}: Props) {
  const displayCwd = formatPathForDisplay(cwd)
  const metaParts = [
    runtimeLabel,
    formatPermissionStatusLabel(permissionLabel),
    displayCwd,
    ...(isBusy ? ['busy'] : []),
    ...(queuedPrompts.length > 0 ? [`queued:${queuedPrompts.length}`] : []),
  ]
  const hasSlashSuggestions = slashSuggestions.length > 0
  const inputSurface = (
    <Box backgroundColor="#f2f2f2" paddingX={1} paddingY={1}>
      <ComposerLine
        cursorIndex={cursorIndex}
        placeholder={placeholder}
        value={inputValue}
      />
    </Box>
  )

  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {questionDialog ? (
        <QuestionDialog dialog={questionDialog} />
      ) : memoryMenu ? (
        <MemoryMenu menu={memoryMenu} />
      ) : skillsMenu ? (
        <SkillsMenu menu={skillsMenu} />
      ) : bottomSheet ? (
        <>
          <BottomSheet sheet={bottomSheet} />
          <Box marginTop={1} paddingX={1}>
            <Text dimColor>Esc return · Enter select</Text>
          </Box>
        </>
      ) : hasSlashSuggestions ? (
        <>
          <QueuedPromptList prompts={queuedPrompts} />
          {inputSurface}
          <SlashSuggestionMenu
            activeIndex={activeSuggestionIndex}
            suggestions={slashSuggestions}
          />
          <Box marginTop={1} paddingX={1}>
            <Text dimColor>Esc return · Enter select</Text>
          </Box>
        </>
      ) : (
        <>
          <QueuedPromptList prompts={queuedPrompts} />
          {inputSurface}
          <Box marginTop={1}>
            <Text dimColor>{metaParts.join(' · ')}</Text>
          </Box>
        </>
      )}
    </Box>
  )
}

function QueuedPromptList({ prompts }: { prompts: string[] }) {
  if (prompts.length === 0) {
    return null
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text dimColor>• </Text>
        <Text bold>Messages to be submitted next</Text>
        <Text dimColor> (press esc to interrupt current response)</Text>
      </Text>
      {prompts.map((prompt, index) => (
        <Box key={`${index}-${prompt}`} paddingLeft={2}>
          <Text dimColor>{`↳ ${prompt}`}</Text>
        </Box>
      ))}
    </Box>
  )
}

function clampCursorIndex(value: string, cursorIndex: number): number {
  return Math.min(Math.max(0, cursorIndex), [...value].length)
}

function ComposerLine({
  cursorIndex,
  placeholder,
  value,
}: {
  cursorIndex: number
  placeholder: string
  value: string
}) {
  if (value.length === 0) {
    return (
      <Text>
        <Text color="black">› </Text>
        <Text color="black">{'\u2588'}</Text>
        <Text color="gray">{placeholder}</Text>
      </Text>
    )
  }

  const chars = [...value]
  const safeCursorIndex = clampCursorIndex(value, cursorIndex)
  const before = chars.slice(0, safeCursorIndex).join('')
  const after = chars.slice(safeCursorIndex).join('')

  return (
    <Text>
      <Text color="black">› </Text>
      <Text color="black">{before}</Text>
      <Text color="black">{'\u2588'}</Text>
      <Text color="black">{after}</Text>
    </Text>
  )
}
