import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatQueuedPromptsForSubmission,
  getStaticTranscriptPrefixLength,
  isShiftTabRawInput,
} from '../../src/tui/App.js'
import {
  createInitialUiState,
  reduceUiEvent,
} from '../../src/tui/state/index.js'
import { formatPermissionStatusLabel } from '../../src/tui/views/BottomDock.js'

test('formatQueuedPromptsForSubmission keeps queued prompts separated by a blank line', () => {
  assert.equal(
    formatQueuedPromptsForSubmission([
      'continue the implementation',
      'then run the tests',
    ]),
    'continue the implementation\n\nthen run the tests',
  )
})

test('isShiftTabRawInput detects terminal Shift+Tab escape sequence', () => {
  assert.equal(isShiftTabRawInput('\x1b[Z'), true)
  assert.equal(isShiftTabRawInput('\t'), false)
})

test('formatPermissionStatusLabel makes plan mode explicit in bottom status', () => {
  assert.equal(
    formatPermissionStatusLabel('plan'),
    'PLAN MODE (Shift+Tab to exit plan)',
  )
  assert.equal(formatPermissionStatusLabel('default'), 'default')
})

test('getStaticTranscriptPrefixLength stops before mutable transcript entries', () => {
  assert.equal(
    getStaticTranscriptPrefixLength([
      {
        id: '1',
        kind: 'user_prompt',
        text: 'hello',
      },
      {
        id: '2',
        kind: 'assistant_draft',
        text: 'working',
      },
      {
        id: '3',
        kind: 'system',
        text: 'later',
      },
    ]),
    1,
  )

  assert.equal(
    getStaticTranscriptPrefixLength([
      {
        id: '1',
        kind: 'activity_group',
        title: 'Activity',
        entries: [
          {
            toolUseId: 'tool_1',
            status: 'started',
            text: 'Reading',
          },
        ],
      },
    ]),
    0,
  )
})

test('reduceUiEvent records interruption and clears the active turn', () => {
  let state = createInitialUiState()
  state = reduceUiEvent(state, {
    type: 'turn_started',
    prompt: 'long running prompt',
    promptKind: 'prompt',
  })
  state = reduceUiEvent(state, {
    type: 'assistant_text_delta',
    text: 'Working',
  })

  state = reduceUiEvent(state, {
    type: 'turn_interrupted',
    prompt: 'long running prompt',
  })

  assert.deepEqual(state.activeTurn, {})
  const notice = state.transcript.at(-1)
  assert.equal(notice?.kind, 'system')
  assert.equal(
    notice?.kind === 'system' ? notice.text : '',
    'Interrupted: long running prompt',
  )
})
