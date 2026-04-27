import assert from 'node:assert/strict'
import test from 'node:test'
import { listReplCommands } from '../../src/cli/replCommands.js'
import {
  completeSlashSuggestion,
  createSlashSuggestionState,
  getActiveSlashSuggestion,
  moveSlashSuggestionSelection,
} from '../../src/tui/hooks/useSlashSuggestions.js'

test('createSlashSuggestionState filters slash commands by command and alias', () => {
  const commandMatches = createSlashSuggestionState('/per', listReplCommands())
  assert.deepEqual(
    commandMatches.suggestions.map(suggestion => suggestion.name),
    ['/permissions'],
  )

  const aliasMatches = createSlashSuggestionState('/cont', listReplCommands())
  assert.deepEqual(
    aliasMatches.suggestions.map(suggestion => [
      suggestion.name,
      suggestion.matchedAlias,
    ]),
    [['/resume', '/continue']],
  )
})

test('slash suggestion selection wraps around', () => {
  const state = createSlashSuggestionState('/', listReplCommands())
  const movedUp = moveSlashSuggestionSelection(state, -1)
  assert.equal(movedUp.activeIndex, state.suggestions.length - 1)

  const movedDown = moveSlashSuggestionSelection(movedUp, 1)
  assert.equal(movedDown.activeIndex, 0)
})

test('completeSlashSuggestion inserts the canonical command and argument space', () => {
  const state = createSlashSuggestionState('/per', listReplCommands())
  const suggestion = getActiveSlashSuggestion(state)
  assert.ok(suggestion)

  assert.equal(completeSlashSuggestion('/per', suggestion), '/permissions ')
})

test('slash suggestions close once freeform arguments are being typed', () => {
  const state = createSlashSuggestionState('/compact summarize this', listReplCommands())
  assert.deepEqual(state.suggestions, [])
})
