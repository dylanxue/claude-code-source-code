import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialUiState, reduceUiEvent } from '../../src/tui/state/index.js'

test('reduceUiEvent appends assistant deltas into a single draft item', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'inspect the file',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: 'Hello',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: ' world',
  })

  const draft = state.transcript.find(item => item.kind === 'assistant_draft')
  assert.ok(draft)
  assert.equal(draft.text, 'Hello world')
})

test('reduceUiEvent updates the same activity entry when tool result arrives', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'inspect the file',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'tool_use_started',
    toolUseId: 'tool_read_1',
    text: 'Reading /tmp/example.txt',
  })
  state = reduceUiEvent(state, {
    type: 'tool_result_received',
    toolUseId: 'tool_read_1',
    text: 'Read /tmp/example.txt (example)',
  })

  const activity = state.transcript.find(item => item.kind === 'activity_group')
  assert.ok(activity)
  assert.equal(activity.entries.length, 1)
  assert.equal(activity.entries[0]?.status, 'completed')
  assert.equal(
    activity.entries[0]?.text,
    'Read /tmp/example.txt (example)',
  )
})

test('reduceUiEvent finalizes an assistant draft on turn completion', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'continue',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: 'Final answer',
  })
  state = reduceUiEvent(state, {
    type: 'turn_completed',
    outputText: 'Final answer',
  })

  assert.equal(
    state.transcript.some(item => item.kind === 'assistant_draft'),
    false,
  )
  const note = [...state.transcript]
    .reverse()
    .find(item => item.kind === 'assistant_note')
  assert.ok(note)
  assert.equal(note.text, 'Final answer')
})

test('reduceUiEvent logs local slash commands without replacing the active turn', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'continue',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: 'Working',
  })
  const activeDraftIdBeforeCommand = state.activeTurn.assistantDraftId

  state = reduceUiEvent(state, {
    type: 'command_logged',
    prompt: '/help',
  })

  assert.equal(state.activeTurn.assistantDraftId, activeDraftIdBeforeCommand)
  const commandEntry = [...state.transcript]
    .reverse()
    .find(item => item.kind === 'user_command')
  assert.ok(commandEntry)
  assert.equal(commandEntry.text, '/help')
})

test('reduceUiEvent clears the transcript and active turn state', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'continue',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: 'Working',
  })

  state = reduceUiEvent(state, {
    type: 'transcript_cleared',
  })

  assert.deepEqual(state.transcript, [])
  assert.deepEqual(state.activeTurn, {})
  assert.equal(state.nextTranscriptItemId, 1)
})

test('reduceUiEvent appends structured cards and time separators', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'structured_card_added',
    title: 'Status',
    entries: [
      { kind: 'row', label: 'session id', value: 'abc123' },
      { kind: 'separator' },
      { kind: 'text', text: 'query trace enabled' },
    ],
  })
  state = reduceUiEvent(state, {
    type: 'time_separator_added',
    text: 'Worked for 1.4s',
  })

  const card = state.transcript.find(item => item.kind === 'structured_card')
  assert.ok(card)
  assert.equal(card.title, 'Status')
  assert.deepEqual(card.entries, [
    { kind: 'row', label: 'session id', value: 'abc123' },
    { kind: 'separator' },
    { kind: 'text', text: 'query trace enabled' },
  ])

  const separator = state.transcript.find(item => item.kind === 'time_separator')
  assert.ok(separator)
  assert.equal(separator.text, 'Worked for 1.4s')
})

test('reduceUiEvent keeps tool results attached to their own activity groups', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'inspect and edit',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'tool_use_started',
    toolUseId: 'tool_read_1',
    title: 'Explored',
    text: 'Reading /tmp/example.txt',
  })
  state = reduceUiEvent(state, {
    type: 'tool_use_started',
    toolUseId: 'tool_edit_1',
    title: 'Edited',
    text: 'Editing /tmp/example.txt',
  })
  state = reduceUiEvent(state, {
    type: 'tool_result_received',
    toolUseId: 'tool_read_1',
    text: 'Read /tmp/example.txt (example)',
  })
  state = reduceUiEvent(state, {
    type: 'tool_result_received',
    toolUseId: 'tool_edit_1',
    text: 'Updated /tmp/example.txt',
  })

  const activityGroups = state.transcript.filter(
    item => item.kind === 'activity_group',
  )
  assert.equal(activityGroups.length, 2)
  assert.equal(activityGroups[0]?.title, 'Explored')
  assert.equal(activityGroups[0]?.entries[0]?.text, 'Read /tmp/example.txt (example)')
  assert.equal(activityGroups[1]?.title, 'Edited')
  assert.equal(activityGroups[1]?.entries[0]?.text, 'Updated /tmp/example.txt')
})

test('reduceUiEvent keeps the assistant draft after tool activity when tools start mid-turn', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'inspect project progress',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: 'Current project status:',
  })
  state = reduceUiEvent(state, {
    type: 'tool_use_started',
    toolUseId: 'tool_bash_1',
    title: 'Ran',
    text: 'Running ls -la /tmp/project',
  })
  state = reduceUiEvent(state, {
    type: 'tool_result_received',
    toolUseId: 'tool_bash_1',
    text: 'Ran ls -la /tmp/project (exit 0)',
  })
  state = reduceUiEvent(state, {
    type: 'turn_completed',
    outputText: 'Current project status:',
  })

  const transcriptKinds = state.transcript.map(item => item.kind)
  assert.deepEqual(transcriptKinds, [
    'user_prompt',
    'activity_group',
    'assistant_note',
  ])
  assert.equal(state.transcript[1]?.kind, 'activity_group')
  assert.equal(state.transcript[2]?.kind, 'assistant_note')
})
