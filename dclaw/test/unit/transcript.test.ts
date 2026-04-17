import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTranscript } from '../../src/session/transcript.js'
import { createToolResultMessage } from '../../src/types/message.js'

test('formatTranscript surfaces plan-mode tool result summaries', () => {
  const message = createToolResultMessage(
    'user',
    'tool_enter_plan',
    {
      status: 'approved',
      boardId: 'board_123',
      planFilePath: '/tmp/project/.dclaw/plans/plan_board_123.md',
    },
    {
      ok: true,
      output: {
        status: 'approved',
        boardId: 'board_123',
        planFilePath: '/tmp/project/.dclaw/plans/plan_board_123.md',
      },
      summary:
        'Plan mode entered with approval. Use /tmp/project/.dclaw/plans/plan_board_123.md as the source of truth and continue planning instead of implementation.',
    },
  )

  const lines = formatTranscript([message], {
    includeThinking: false,
  })

  assert.equal(lines.length, 1)
  assert.match(
    lines[0] ?? '',
    /Plan mode entered with approval\./,
  )
})
