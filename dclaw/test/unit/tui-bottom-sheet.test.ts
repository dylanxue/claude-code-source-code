import assert from 'node:assert/strict'
import test from 'node:test'
import { listSlashCommands } from '../../src/cli/slashCommands.js'
import {
  completeBottomSheetSelection,
  createBottomSheetForInput,
  moveBottomSheetSelection,
  type BottomSheetOptionsByCommand,
} from '../../src/tui/hooks/useBottomSheet.js'

const optionsByCommand: BottomSheetOptionsByCommand = {
  '/permissions': [
    {
      value: 'default',
      label: 'default',
    },
    {
      value: 'bypass-permissions',
      label: 'bypass-permissions',
    },
  ],
  '/runtime': [
    {
      value: 'fast',
      label: 'fast',
    },
    {
      value: 'review',
      label: 'review',
    },
  ],
}

test('createBottomSheetForInput opens enum command sheets without arguments', () => {
  const permissionsSheet = createBottomSheetForInput(
    '/permissions',
    optionsByCommand,
    listSlashCommands(),
  )
  assert.ok(permissionsSheet)
  assert.equal(permissionsSheet.command.name, '/permissions')
  assert.equal(permissionsSheet.dismissInputValue, '')
  assert.deepEqual(
    permissionsSheet.options.map(option => option.value),
    ['default', 'bypass-permissions'],
  )

  const runtimeSheet = createBottomSheetForInput(
    '/runtime ',
    optionsByCommand,
    listSlashCommands(),
  )
  assert.ok(runtimeSheet)
  assert.equal(runtimeSheet.command.name, '/runtime')
  assert.equal(runtimeSheet.title, 'Select Runtime')
  assert.match(runtimeSheet.description, /takes effect immediately/)
  assert.equal(runtimeSheet.dismissInputValue, '')
})

test('createBottomSheetForInput skips enum commands once an argument is typed', () => {
  const sheet = createBottomSheetForInput(
    '/permissions default',
    optionsByCommand,
    listSlashCommands(),
  )

  assert.equal(sheet, undefined)
})

test('bottom sheet selection wraps and completes to a command prompt', () => {
  const sheet = createBottomSheetForInput(
    '/permissions',
    optionsByCommand,
    listSlashCommands(),
  )
  assert.ok(sheet)

  const moved = moveBottomSheetSelection(sheet, -1)
  assert.equal(moved.selectedIndex, 1)
  assert.equal(
    completeBottomSheetSelection(moved),
    '/permissions bypass-permissions',
  )
})
