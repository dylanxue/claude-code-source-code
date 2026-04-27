import { listReplCommands, type ReplCommandCatalogItem } from '../../cli/replCommands.js'

export type BottomSheetOption = {
  value: string
  label: string
  description?: string
}

export type BottomSheetState = {
  command: ReplCommandCatalogItem
  title: string
  description: string
  dismissInputValue: string
  options: BottomSheetOption[]
  selectedIndex: number
}

export type BottomSheetOptionsByCommand = Record<string, BottomSheetOption[]>

function getBottomSheetTitle(command: ReplCommandCatalogItem): string {
  return `Select ${command.displayName}`
}

function getBottomSheetDescription(command: ReplCommandCatalogItem): string {
  if (command.name === '/runtime') {
    return 'Selecting a runtime takes effect immediately. Switching runtime during a conversation may reduce answer quality.'
  }

  if (command.name === '/permissions') {
    return 'Selecting a permission mode takes effect immediately for the current session.'
  }

  return command.description
}

function parseCommandName(inputValue: string): string {
  return inputValue.trim().split(/\s+/u)[0]?.toLowerCase() ?? ''
}

export function findReplCommandForInput(
  inputValue: string,
  commands: ReplCommandCatalogItem[] = listReplCommands(),
): ReplCommandCatalogItem | undefined {
  const commandName = parseCommandName(inputValue)
  if (!commandName) {
    return undefined
  }

  return commands.find(
    command =>
      command.name.toLowerCase() === commandName ||
      command.aliases?.some(alias => alias.toLowerCase() === commandName),
  )
}

export function hasCommandArgument(inputValue: string): boolean {
  const trimmed = inputValue.trim()
  const firstWhitespace = trimmed.search(/\s/u)
  if (firstWhitespace < 0) {
    return false
  }

  return trimmed.slice(firstWhitespace).trim().length > 0
}

export function createBottomSheetForInput(
  inputValue: string,
  optionsByCommand: BottomSheetOptionsByCommand,
  commands: ReplCommandCatalogItem[] = listReplCommands(),
): BottomSheetState | undefined {
  const command = findReplCommandForInput(inputValue, commands)
  if (!command || command.argKind !== 'enum' || hasCommandArgument(inputValue)) {
    return undefined
  }

  const options = optionsByCommand[command.name] ?? []
  if (options.length === 0) {
    return undefined
  }

  return {
    command,
    title: getBottomSheetTitle(command),
    description: getBottomSheetDescription(command),
    dismissInputValue: '',
    options,
    selectedIndex: 0,
  }
}

export function moveBottomSheetSelection(
  state: BottomSheetState,
  direction: 1 | -1,
): BottomSheetState {
  return {
    ...state,
    selectedIndex:
      (state.selectedIndex + direction + state.options.length) %
      state.options.length,
  }
}

export function completeBottomSheetSelection(state: BottomSheetState): string {
  const option = state.options[state.selectedIndex]
  if (!option) {
    return state.command.name
  }

  return `${state.command.name} ${option.value}`.trim()
}

export function useBottomSheet(
  inputValue: string,
  optionsByCommand: BottomSheetOptionsByCommand,
): BottomSheetState | undefined {
  return createBottomSheetForInput(inputValue, optionsByCommand)
}
