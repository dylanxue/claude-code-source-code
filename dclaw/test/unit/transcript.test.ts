import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTranscript } from '../../src/session/transcript.js'
import {
  createImageBlock,
  createMessage,
  createToolResultMessage,
  createToolUseMessage,
} from '../../src/types/message.js'

test('formatTranscript surfaces plan-mode tool result summaries', () => {
  const message = createToolResultMessage(
    'user',
    'tool_enter_plan',
    {
      status: 'entered',
      boardId: 'board_123',
      planFilePath: '/tmp/project/.dclaw/plans/plan_board_123.md',
    },
    {
      ok: true,
      output: {
        status: 'entered',
        boardId: 'board_123',
        planFilePath: '/tmp/project/.dclaw/plans/plan_board_123.md',
      },
      summary:
        'Planning lock entered. Use /tmp/project/.dclaw/plans/plan_board_123.md as the source of truth and continue planning instead of implementation.',
    },
  )

  const lines = formatTranscript([message], {
    includeThinking: false,
  })

  assert.equal(lines.length, 1)
  assert.match(
    lines[0] ?? '',
    /Planning lock entered\./,
  )
})

test('formatTranscript renders plan-mode tool use and result summaries clearly', () => {
  const lines = formatTranscript(
    [
      createMessage('assistant', [
        {
          type: 'tool_use',
          id: 'tool_enter_plan',
          name: 'EnterPlanMode',
          input: {
            note: 'Need to inspect the codebase before implementation.',
          },
        },
      ]),
      createToolResultMessage(
        'user',
        'tool_enter_plan',
        {
          status: 'entered',
          boardId: 'board_123',
          planFilePath: '/tmp/project/.dclaw/plans/plan_board_123.md',
        },
        {
          ok: true,
          output: {
            status: 'entered',
            boardId: 'board_123',
            planFilePath: '/tmp/project/.dclaw/plans/plan_board_123.md',
          },
          summary:
            'Planning lock entered. Use /tmp/project/.dclaw/plans/plan_board_123.md as the source of truth and continue planning instead of implementation.',
        },
      ),
    ],
    {
      includeThinking: false,
    },
  )

  assert.ok(lines.some(line => /\[plan mode\] enter:/.test(line)))
  assert.ok(lines.some(line => /\[planning lock\] entered:/.test(line)))
})

test('formatTranscript renders generic tool use and results with natural phrasing', () => {
  const lines = formatTranscript(
    [
      createMessage('assistant', [
        {
          type: 'tool_use',
          id: 'tool_read',
          name: 'Read',
          input: {
            file_path: '/tmp/example.ts',
            offset: 1,
            limit: 2,
          },
        },
      ]),
      createToolResultMessage(
        'user',
        'tool_read',
        {
          summary: 'Read /tmp/example.ts',
          file: {
            filePath: '/tmp/example.ts',
            content: 'export const value = 1\nconsole.log(value)\n',
            numLines: 2,
            startLine: 1,
            endLine: 2,
            totalLines: 20,
          },
        },
        {
          ok: true,
          summary: 'Read /tmp/example.ts',
          output: {
            type: 'text',
            file: {
              filePath: '/tmp/example.ts',
              content: 'export const value = 1\nconsole.log(value)\n',
              numLines: 2,
              startLine: 1,
              endLine: 2,
              totalLines: 20,
            },
            isPartial: true,
            didReadToEnd: false,
          },
        },
      ),
    ],
    {
      includeThinking: false,
    },
  )

  assert.ok(lines.some(line => line === 'Reading /tmp/example.ts:1-2'))
  assert.ok(
    lines.some(
      line =>
        line ===
        'Read /tmp/example.ts:1-2 (lines 1-2 of 20; starts with "export const value = 1")',
    ),
  )
})

test('formatTranscript renders subagent wait results clearly', () => {
  const toolUse = createToolUseMessage('assistant', 'Agent', {
    action: 'wait',
    agent_id: 'lesson-analyzer',
  })
  const toolUseId =
    toolUse.content[0]?.type === 'tool_use' ? toolUse.content[0].id : ''

  const lines = formatTranscript(
    [
      toolUse,
      createToolResultMessage(
        'user',
        toolUseId,
        {
          action: 'wait',
          agent: {
            agent_id: 'lesson-analyzer',
            status: 'completed',
            task: 'Analyze lesson1',
          },
          result: {
            summary: 'analyzed lesson1',
            output_text: 'lesson1 matches requirements',
          },
        },
        {
          ok: true,
          summary: 'Subagent lesson-analyzer completed: analyzed lesson1',
          output: {
            action: 'wait',
            agent: {
              agent_id: 'lesson-analyzer',
              status: 'completed',
              task: 'Analyze lesson1',
            },
            result: {
              summary: 'analyzed lesson1',
              output_text: 'lesson1 matches requirements',
            },
          },
        },
      ),
    ],
    {
      includeThinking: false,
    },
  )

  assert.ok(lines.some(line => line === 'Waiting for subagent lesson-analyzer'))
  assert.ok(
    lines.some(
      line =>
        line ===
        'Subagent lesson-analyzer completed (analyzed lesson1)',
    ),
  )
})

test('formatTranscript renders reasoning and thinking in a readable style', () => {
  const lines = formatTranscript(
    [
      createMessage('assistant', [
        {
          type: 'reasoning',
          summary: ['Inspect before using Read.'],
          status: 'completed',
        },
        {
          type: 'thinking',
          thinking: 'Need to inspect the file contents first.',
          signature: 'sig_1',
        },
        {
          type: 'redacted_thinking',
          data: 'hidden-data',
        },
      ]),
    ],
    {
      includeThinking: true,
    },
  )

  assert.ok(lines.some(line => line === 'Reasoning: Inspect before using Read.'))
  assert.ok(
    lines.some(line => line === 'Thinking: Need to inspect the file contents first.'),
  )
  assert.ok(lines.some(line => line === 'Thinking: [hidden (11 chars)]'))
})

test('formatTranscript renders image placeholders without leaking base64 payloads', () => {
  const lines = formatTranscript(
    [
      createMessage('user', [createImageBlock('image/png', 'abc123base64payload')]),
      createMessage('assistant', [
        {
          type: 'text',
          text: 'I inspected the image.',
        },
        createImageBlock('image/png', 'anotherbase64payload'),
      ]),
    ],
    {
      includeThinking: false,
    },
  )

  assert.ok(lines.includes('user: [image]'))
  assert.ok(lines.includes('assistant: I inspected the image. [image]'))
  assert.ok(lines.every(line => !line.includes('base64payload')))
})
