import { listReplCommands, type ReplCommandCatalogItem } from '../../cli/replCommands.js'

export type SlashSuggestion = ReplCommandCatalogItem & {
  matchedAlias?: string
}

export type SlashSuggestionState = {
  suggestions: SlashSuggestion[]
  activeIndex: number
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function getSlashFilter(inputValue: string): string | undefined {
  if (!inputValue.startsWith('/')) {
    return undefined
  }

  if (/\s/u.test(inputValue)) {
    return undefined
  }

  const firstToken = inputValue.split(/\s+/u)[0] ?? ''
  if (firstToken.length === 0) {
    return undefined
  }

  return normalize(firstToken)
}

function matchesCommand(
  command: ReplCommandCatalogItem,
  filter: string,
): SlashSuggestion | undefined {
  if (command.name.toLowerCase().startsWith(filter)) {
    return command
  }

  const matchedAlias = command.aliases?.find(alias =>
    alias.toLowerCase().startsWith(filter),
  )
  if (!matchedAlias) {
    return undefined
  }

  return {
    ...command,
    matchedAlias,
  }
}

export function createSlashSuggestionState(
  inputValue: string,
  commands: ReplCommandCatalogItem[] = listReplCommands(),
  activeIndex = 0,
): SlashSuggestionState {
  const filter = getSlashFilter(inputValue)
  if (!filter) {
    return {
      suggestions: [],
      activeIndex: 0,
    }
  }

  const suggestions = commands
    .map(command => matchesCommand(command, filter))
    .filter((command): command is SlashSuggestion => Boolean(command))

  return {
    suggestions,
    activeIndex:
      suggestions.length === 0
        ? 0
        : Math.max(0, Math.min(activeIndex, suggestions.length - 1)),
  }
}

export function moveSlashSuggestionSelection(
  state: SlashSuggestionState,
  direction: 1 | -1,
): SlashSuggestionState {
  if (state.suggestions.length === 0) {
    return state
  }

  return {
    ...state,
    activeIndex:
      (state.activeIndex + direction + state.suggestions.length) %
      state.suggestions.length,
  }
}

export function getActiveSlashSuggestion(
  state: SlashSuggestionState,
): SlashSuggestion | undefined {
  return state.suggestions[state.activeIndex]
}

export function completeSlashSuggestion(
  inputValue: string,
  suggestion: SlashSuggestion,
): string {
  const hasTrailingWhitespace = /\s$/u.test(inputValue)
  const [, ...rest] = inputValue.split(/\s+/u)
  const existingArgs = rest.join(' ').trim()

  if (existingArgs.length > 0) {
    return `${suggestion.name} ${existingArgs}`
  }

  if (suggestion.argKind === 'none') {
    return suggestion.name
  }

  return `${suggestion.name}${hasTrailingWhitespace ? ' ' : ' '}`
}

export function useSlashSuggestions(
  inputValue: string,
  activeIndex = 0,
): SlashSuggestionState {
  return createSlashSuggestionState(inputValue, listReplCommands(), activeIndex)
}
