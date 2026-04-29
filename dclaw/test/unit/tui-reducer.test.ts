import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createInitialUiState,
  reduceUiEvent,
  type TaskListSnapshot,
  type TranscriptItem,
} from '../../src/tui/state/index.js'

function createTaskSnapshot(
  overrides: Partial<TaskListSnapshot> = {},
): TaskListSnapshot {
  return {
    boardId: 'taskboard_1',
    title: 'TUI rollout',
    executionState: 'active',
    updatedAt: '2026-04-29T00:00:00.000Z',
    completedCount: 1,
    totalCount: 3,
    currentTaskId: '2',
    tasks: [
      {
        id: '1',
        subject: 'Define snapshot state',
        status: 'completed',
        blockedBy: [],
        isCurrent: false,
      },
      {
        id: '2',
        subject: 'Render snapshot',
        status: 'in_progress',
        blockedBy: [],
        isCurrent: true,
      },
      {
        id: '3',
        subject: 'Test snapshot',
        status: 'pending',
        blockedBy: ['2'],
        isCurrent: false,
      },
    ],
    ...overrides,
  }
}

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

test('reduceUiEvent does not duplicate streamed assistant chunks on turn completion', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'continue',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_stream_chunk',
    text: 'First line\n',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_stream_chunk',
    text: 'Second line',
  })
  state = reduceUiEvent(state, {
    type: 'turn_completed',
    outputText: 'First line\nSecond line',
  })

  assert.deepEqual(
    state.transcript
      .filter(item => item.kind === 'assistant_stream_chunk')
      .map(item => (item.kind === 'assistant_stream_chunk' ? item.text : '')),
    ['First line\n', 'Second line'],
  )
  assert.equal(
    state.transcript.some(item => item.kind === 'assistant_note'),
    false,
  )
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

test('reduceUiEvent appends full task snapshots', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'implement the task list',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: 'Creating tasks',
  })
  state = reduceUiEvent(state, {
    type: 'task_board_updated',
    snapshot: createTaskSnapshot(),
  })

  assert.deepEqual(
    state.transcript.map(item => item.kind),
    ['user_prompt', 'assistant_note', 'task_list_snapshot'],
  )
  const snapshot = state.transcript.find(
    item => item.kind === 'task_list_snapshot',
  )
  assert.ok(snapshot)
  assert.equal(snapshot.collapsed, false)
  assert.equal(snapshot.snapshot.completedCount, 1)
  assert.equal(snapshot.snapshot.tasks[1]?.isCurrent, true)
  assert.equal(state.activeTurn.assistantDraftId, undefined)
})

test('reduceUiEvent keeps task snapshots expanded and skips identical repeats', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'task_board_updated',
    snapshot: createTaskSnapshot(),
  })
  state = reduceUiEvent(state, {
    type: 'task_board_updated',
    snapshot: createTaskSnapshot(),
  })

  assert.equal(
    state.transcript.filter(item => item.kind === 'task_list_snapshot').length,
    1,
  )

  state = reduceUiEvent(state, {
    type: 'task_board_updated',
    snapshot: createTaskSnapshot({
      updatedAt: '2026-04-29T00:01:00.000Z',
      completedCount: 2,
      currentTaskId: '3',
      tasks: [
        {
          id: '1',
          subject: 'Define snapshot state',
          status: 'completed',
          blockedBy: [],
          isCurrent: false,
        },
        {
          id: '2',
          subject: 'Render snapshot',
          status: 'completed',
          blockedBy: [],
          isCurrent: false,
        },
        {
          id: '3',
          subject: 'Test snapshot',
          status: 'in_progress',
          blockedBy: [],
          isCurrent: true,
        },
      ],
    }),
  })

  const snapshots = state.transcript.filter(
    (
      item,
    ): item is Extract<TranscriptItem, { kind: 'task_list_snapshot' }> =>
      item.kind === 'task_list_snapshot',
  )
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[0]?.collapsed, false)
  assert.equal(snapshots[1]?.collapsed, false)
  assert.equal(snapshots[1]?.snapshot.currentTaskId, '3')
})

test('reduceUiEvent appends plan snapshots and skips identical repeats', () => {
  let state = createInitialUiState()
  const snapshot = {
    sessionId: 'session_1',
    status: 'active' as const,
    updatedAt: '2026-04-29T00:00:00.000Z',
    planFilePath: '/tmp/PLAN.md',
  }

  state = reduceUiEvent(state, {
    type: 'plan_mode_updated',
    snapshot,
  })
  state = reduceUiEvent(state, {
    type: 'plan_mode_updated',
    snapshot,
  })

  const snapshots = state.transcript.filter(
    (item): item is Extract<TranscriptItem, { kind: 'plan_mode_snapshot' }> =>
      item.kind === 'plan_mode_snapshot',
  )
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0]?.snapshot.status, 'active')
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

test('reduceUiEvent seals pre-tool assistant text in place when tools start mid-turn', () => {
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
    'assistant_note',
    'activity_group',
  ])
  assert.equal(state.transcript[1]?.kind, 'assistant_note')
  assert.equal(state.transcript[2]?.kind, 'activity_group')
  assert.equal(
    state.transcript[1]?.kind === 'assistant_note'
      ? state.transcript[1].text
      : '',
    'Current project status:',
  )
})
