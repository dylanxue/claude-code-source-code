import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendAssistantTextDeltaToBuffer,
  createAssistantTextBufferState,
  formatQueuedPromptsForSubmission,
  flushAssistantTextBufferState,
  getStaticTranscriptPrefixLength,
  isShiftTabRawInput,
} from '../../src/tui/App.js'
import {
  createInitialUiState,
  reduceUiEvent,
} from '../../src/tui/state/index.js'
import { getTranscriptEntryMarginBottom } from '../../src/tui/views/TranscriptPane.js'
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

test('getStaticTranscriptPrefixLength stops before trailing mutable transcript entries', () => {
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
        kind: 'assistant_stream_chunk',
        text: 'streaming',
      },
    ]),
    0,
  )

  assert.equal(
    getStaticTranscriptPrefixLength([
      {
        id: '1',
        kind: 'assistant_stream_chunk',
        text: 'streaming',
      },
      {
        id: '2',
        kind: 'assistant_stream_chunk',
        text: 'more streaming',
      },
    ]),
    1,
  )

  assert.equal(
    getStaticTranscriptPrefixLength([
      {
        id: '1',
        kind: 'assistant_stream_chunk',
        text: 'streaming',
      },
      {
        id: '2',
        kind: 'system',
        text: 'later',
      },
    ]),
    2,
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

test('assistant text buffer flushes pre-tool prose before later transcript events', () => {
  const buffered = appendAssistantTextDeltaToBuffer(
    createAssistantTextBufferState(),
    'Checking the workspace before writing the file.',
  )
  assert.deepEqual(buffered.completedChunks, [
    'Checking the workspace before writing the file.',
  ])

  const flushed = flushAssistantTextBufferState(buffered.nextState)
  const orderedEventTypes = [
    ...(flushed.text ? ['assistant_stream_chunk'] : []),
    'tool_use_started',
  ]

  assert.equal(flushed.text, undefined)
  assert.deepEqual(orderedEventTypes, ['tool_use_started'])
})

test('assistant text buffer eagerly flushes a completed sentence without waiting for a newline', () => {
  const buffered = appendAssistantTextDeltaToBuffer(
    createAssistantTextBufferState(),
    '我先整理一份面向实现的人机对战中国象棋技术方案，并写入 `docs` 目录。',
  )

  assert.deepEqual(buffered.completedChunks, [
    '我先整理一份面向实现的人机对战中国象棋技术方案，并写入 `docs` 目录。',
  ])
  assert.equal(buffered.nextState.length, 0)
  assert.deepEqual(buffered.nextState.segments, [])
})

test('assistant text buffer eagerly flushes long prose even without sentence punctuation', () => {
  const buffered = appendAssistantTextDeltaToBuffer(
    createAssistantTextBufferState(),
    'This is a long streaming prefix that should surface before any tool event even when it still has no newline',
  )

  assert.deepEqual(buffered.completedChunks, [
    'This is a long streaming prefix that should surface before any tool event even when it still has no newline',
  ])
  assert.equal(buffered.nextState.length, 0)
  assert.deepEqual(buffered.nextState.segments, [])
})

test('transcript spacing keeps consecutive stream chunks tight but separates later activity', () => {
  assert.equal(
    getTranscriptEntryMarginBottom(
      {
        id: 'tx_1',
        kind: 'assistant_stream_chunk',
        text: '先说明计划',
      },
      {
        id: 'tx_2',
        kind: 'assistant_stream_chunk',
        text: '再补充一句',
      },
    ),
    0,
  )

  assert.equal(
    getTranscriptEntryMarginBottom(
      {
        id: 'tx_1',
        kind: 'assistant_stream_chunk',
        text: '先说明计划',
      },
      {
        id: 'tx_2',
        kind: 'activity_group',
        title: 'Explored',
        entries: [],
      },
    ),
    1,
  )
})
