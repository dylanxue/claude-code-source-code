import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTranscript } from '../../src/session/transcript.js'
import { createMessage, createTextMessage } from '../../src/types/message.js'

test('formatTranscript renders assistant reasoning tool use and tool result blocks', () => {
  const lines = formatTranscript([
    createTextMessage('user', 'Inspect the file'),
    createMessage('assistant', [
      {
        type: 'reasoning',
        summary: ['Inspect before using Read.'],
        status: 'completed',
      },
      {
        type: 'text',
        text: 'Need to inspect first.',
      },
      {
        type: 'tool_use',
        id: 'tool_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ]),
    createMessage('user', [
      {
        type: 'tool_result',
        toolUseId: 'tool_1',
        output: {
          ok: true,
          summary: 'Read /tmp/example.txt',
          output: {
            sandboxMode: 'restricted',
          },
        },
      },
    ]),
  ])

  assert.deepEqual(lines, [
    'user: Inspect the file',
    '',
    'assistant: Need to inspect first.',
    '[reasoning] Inspect before using Read.',
    '[tool use] Read {"file_path":"/tmp/example.txt"}',
    '',
    'tool result (tool_1): Read /tmp/example.txt [sandbox: restricted]',
  ])
})

test('formatTranscript includes thinking blocks only when requested', () => {
  const messages = [
    createMessage('assistant', [
      {
        type: 'thinking',
        thinking: 'Inspect the file before editing it.',
      },
      {
        type: 'redacted_thinking',
        data: 'secret',
      },
    ]),
  ]

  assert.deepEqual(formatTranscript(messages), ['assistant:'])
  assert.deepEqual(formatTranscript(messages, { includeThinking: true }), [
    'assistant:',
    '[thinking] Inspect the file before editing it.',
    '[redacted thinking] hidden (6 chars)',
  ])
})

test('formatTranscript can preview only the latest messages', () => {
  const lines = formatTranscript(
    [
      createTextMessage('user', 'one'),
      createTextMessage('assistant', 'two'),
      createTextMessage('user', 'three'),
    ],
    { maxMessages: 2 },
  )

  assert.deepEqual(lines, [
    '... 1 earlier messages omitted ...',
    '',
    'assistant: two',
    '',
    'user: three',
  ])
})
