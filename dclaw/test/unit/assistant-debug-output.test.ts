import assert from 'node:assert/strict'
import test from 'node:test'
import { formatAssistantDebugOutput } from '../../src/cli/assistantDebugOutput.js'
import { createMessage } from '../../src/types/message.js'

test('formatAssistantDebugOutput summarizes reasoning thinking and tool use blocks', () => {
  const lines = formatAssistantDebugOutput([
    createMessage('assistant', [
      {
        type: 'reasoning',
        summary: ['Inspect the file before editing it.'],
        id: 'rs_1',
        encryptedContent: 'enc_1',
        status: 'completed',
      },
      {
        type: 'thinking',
        thinking: 'I should inspect the file before using Edit.',
        signature: 'sig_1',
      },
      {
        type: 'tool_use',
        id: 'tool_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
      {
        type: 'text',
        text: 'Done.',
      },
    ]),
  ])

  assert.deepEqual(lines, [
    'assistant message:',
    '[reasoning] Inspect the file before editing it.',
    '[thinking] I should inspect the file before using Edit.',
    '[tool use] Read {"file_path":"/tmp/example.txt"}',
    '[assistant text] Done.',
  ])
})

test('formatAssistantDebugOutput notes redacted thinking blocks', () => {
  const lines = formatAssistantDebugOutput([
    createMessage('assistant', [
      {
        type: 'redacted_thinking',
        data: 'secret',
      },
    ]),
  ])

  assert.deepEqual(lines, [
    'assistant message:',
    '[redacted thinking] hidden (6 chars)',
  ])
})
