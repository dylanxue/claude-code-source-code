import React from 'react'
import { Box, Text } from '../../ink/index.js'
import type { StoredMemoryFile } from '../../memory/store.js'

export type MemoryMenuMode = 'root' | 'list' | 'view' | 'delete' | 'confirm_delete'

export type MemoryMenuState = {
  activeRelativePath?: string
  errorText?: string
  isLoading: boolean
  mode: MemoryMenuMode
  searchQuery: string
  selectedIndex: number
  statusText?: string
  viewScrollOffset: number
  memories: StoredMemoryFile[]
}

type Props = {
  menu: MemoryMenuState
}

const MAX_VISIBLE_MEMORIES = 8
const MAX_VISIBLE_MEMORY_BODY_LINES = 9

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function getSortTimestamp(memory: StoredMemoryFile): number {
  const parsed = Date.parse(memory.frontmatter?.updated_at ?? '')
  return Number.isNaN(parsed) ? memory.mtimeMs : parsed
}

export function getMemoryDisplayName(memory: StoredMemoryFile): string {
  return memory.frontmatter?.name?.trim() || memory.relativePath
}

function getMemoryTypeLabel(memory: StoredMemoryFile): string {
  return memory.frontmatter?.type ? `[${memory.frontmatter.type}]` : '[memory]'
}

function getMemoryDescription(memory: StoredMemoryFile): string {
  return memory.frontmatter?.description?.trim() || memory.relativePath
}

function getMemoryUpdatedAt(memory: StoredMemoryFile): string {
  if (memory.frontmatter?.updated_at) {
    return memory.frontmatter.updated_at
  }

  return new Date(memory.mtimeMs).toISOString()
}

export function filterMemoryFiles(
  memories: StoredMemoryFile[],
  searchQuery: string,
): StoredMemoryFile[] {
  const query = normalize(searchQuery)
  const sorted = [...memories].sort(
    (left, right) => getSortTimestamp(right) - getSortTimestamp(left),
  )

  if (!query) {
    return sorted
  }

  return sorted.filter(memory =>
    [
      memory.relativePath,
      getMemoryDisplayName(memory),
      getMemoryDescription(memory),
      memory.frontmatter?.type,
      memory.body,
    ]
      .filter((value): value is string => Boolean(value))
      .some(value => normalize(value).includes(query)),
  )
}

export function getSelectedMemory(
  menu: MemoryMenuState,
): StoredMemoryFile | undefined {
  if (menu.activeRelativePath) {
    return menu.memories.find(
      memory => memory.relativePath === menu.activeRelativePath,
    )
  }

  const memories = filterMemoryFiles(menu.memories, menu.searchQuery)
  return memories[Math.max(0, Math.min(menu.selectedIndex, memories.length - 1))]
}

export function getMemoryBodyLines(memory: StoredMemoryFile): string[] {
  const body = memory.body.trimEnd()
  return body.length > 0 ? body.split('\n') : ['<empty>']
}

function getVisibleWindowStart(
  selectedIndex: number,
  itemCount: number,
): number {
  if (itemCount <= MAX_VISIBLE_MEMORIES) {
    return 0
  }

  return Math.min(
    Math.max(selectedIndex - MAX_VISIBLE_MEMORIES + 1, 0),
    itemCount - MAX_VISIBLE_MEMORIES,
  )
}

function RootMenu({ errorText, isLoading, selectedIndex, statusText }: {
  errorText?: string
  isLoading: boolean
  selectedIndex: number
  statusText?: string
}) {
  const options = [
    {
      label: 'List and view memories',
      description: 'Browse saved workspace memory files.',
    },
    {
      label: 'Delete memories',
      description: 'Remove obsolete memory files from this workspace.',
    },
  ]

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>Memory</Text>
      <Text dimColor>Choose how you want to work with workspace memory.</Text>
      {isLoading ? <Text dimColor>Loading memory...</Text> : null}
      {errorText ? <Text color="red">{errorText}</Text> : null}
      {statusText ? <Text color="green">{statusText}</Text> : null}
      <Box height={1} />
      {options.map((option, index) => (
        <Text key={option.label} color={index === selectedIndex ? 'cyan' : undefined}>
          {`${index === selectedIndex ? '›' : ' '} ${option.label}  ${option.description}`}
        </Text>
      ))}
      <Box height={1} />
      <Text dimColor>Press enter to select or esc to close</Text>
    </Box>
  )
}

function MemoryList({
  deleteMode,
  menu,
}: {
  deleteMode: boolean
  menu: MemoryMenuState
}) {
  const memories = filterMemoryFiles(menu.memories, menu.searchQuery)
  const windowStart = getVisibleWindowStart(menu.selectedIndex, memories.length)
  const visibleMemories = memories.slice(
    windowStart,
    windowStart + MAX_VISIBLE_MEMORIES,
  )

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>{deleteMode ? 'Delete Memory' : 'Workspace Memory'}</Text>
      <Text dimColor>
        {deleteMode
          ? 'Select a memory file to remove from this workspace.'
          : 'Select a memory to view its saved content.'}
      </Text>
      {menu.statusText ? <Text color="green">{menu.statusText}</Text> : null}
      <Box height={1} />
      <Text dimColor>Type to search memories</Text>
      <Text>{`> ${menu.searchQuery}`}</Text>
      <Box height={1} />
      {menu.isLoading ? <Text dimColor>Loading memory...</Text> : null}
      {menu.errorText ? <Text color="red">{menu.errorText}</Text> : null}
      {!menu.isLoading && !menu.errorText && visibleMemories.length === 0 ? (
        <Text dimColor>No matching memories</Text>
      ) : null}
      {visibleMemories.map((memory, index) => {
        const absoluteIndex = windowStart + index
        const isActive = absoluteIndex === menu.selectedIndex
        return (
          <Text key={memory.relativePath} color={isActive ? 'cyan' : undefined} wrap="truncate-end">
            {`${isActive ? '›' : ' '} ${getMemoryDisplayName(memory).padEnd(28)} ${getMemoryTypeLabel(memory)} ${getMemoryDescription(memory)}`}
          </Text>
        )
      })}
      <Box height={1} />
      <Text dimColor>
        {deleteMode
          ? 'Press enter to choose, type to search, or esc to go back'
          : 'Press enter to view, type to search, or esc to go back'}
      </Text>
    </Box>
  )
}

function MemoryView({ menu }: { menu: MemoryMenuState }) {
  const memory = getSelectedMemory(menu)
  if (!memory) {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text bold>Memory</Text>
        <Text dimColor>No memory selected</Text>
      </Box>
    )
  }

  const bodyLines = getMemoryBodyLines(memory)
  const maxOffset = Math.max(0, bodyLines.length - MAX_VISIBLE_MEMORY_BODY_LINES)
  const scrollOffset = Math.max(0, Math.min(menu.viewScrollOffset, maxOffset))
  const visibleLines = bodyLines.slice(
    scrollOffset,
    scrollOffset + MAX_VISIBLE_MEMORY_BODY_LINES,
  )

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>{getMemoryDisplayName(memory)}</Text>
      <Text dimColor>{`${memory.relativePath}  ${getMemoryTypeLabel(memory)}  updated ${getMemoryUpdatedAt(memory)}`}</Text>
      <Text dimColor>{getMemoryDescription(memory)}</Text>
      <Box height={1} />
      {visibleLines.map((line, index) => (
        <Text key={`${scrollOffset}-${index}-${line}`} wrap="truncate-end">
          {line.length > 0 ? line : ' '}
        </Text>
      ))}
      {bodyLines.length > MAX_VISIBLE_MEMORY_BODY_LINES ? (
        <Text dimColor>{`${scrollOffset + 1}-${Math.min(scrollOffset + MAX_VISIBLE_MEMORY_BODY_LINES, bodyLines.length)} of ${bodyLines.length}`}</Text>
      ) : null}
      <Box height={1} />
      <Text dimColor>Use up/down to scroll, d to delete, enter or esc to go back</Text>
    </Box>
  )
}

function ConfirmDelete({ menu }: { menu: MemoryMenuState }) {
  const memory = getSelectedMemory(menu)
  if (!memory) {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text bold>Delete Memory</Text>
        <Text dimColor>No memory selected</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>Delete Memory</Text>
      <Text>{`Delete ${getMemoryDisplayName(memory)}?`}</Text>
      <Text dimColor>{memory.relativePath}</Text>
      <Text color="red">This removes the memory file from this workspace.</Text>
      {menu.errorText ? <Text color="red">{menu.errorText}</Text> : null}
      <Box height={1} />
      <Text dimColor>Press enter to delete or esc to go back</Text>
    </Box>
  )
}

export function MemoryMenu({ menu }: Props) {
  if (menu.mode === 'root') {
    return (
      <RootMenu
        errorText={menu.errorText}
        isLoading={menu.isLoading}
        selectedIndex={menu.selectedIndex}
        statusText={menu.statusText}
      />
    )
  }

  if (menu.mode === 'view') {
    return <MemoryView menu={menu} />
  }

  if (menu.mode === 'confirm_delete') {
    return <ConfirmDelete menu={menu} />
  }

  return <MemoryList deleteMode={menu.mode === 'delete'} menu={menu} />
}
