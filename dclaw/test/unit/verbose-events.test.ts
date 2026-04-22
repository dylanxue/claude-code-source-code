import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatProgressToolResultLine,
  formatProgressToolUseLine,
  formatVerboseLines,
} from '../../src/cli/verboseEvents.js'
import {
  createTextMessage,
  createToolResultMessage,
  createToolUseMessage,
} from '../../src/types/message.js'

test('formatProgressToolUseLine includes the tool target', () => {
  assert.equal(
    formatProgressToolUseLine({
      name: 'Read',
      input: {
        file_path: '/tmp/example.ts',
        offset: 10,
        limit: 5,
      },
    }),
    'Reading /tmp/example.ts:10-14',
  )

  assert.equal(
    formatProgressToolUseLine({
      name: 'Bash',
      input: {
        command: 'git status --short',
      },
    }),
    'Running git status --short',
  )
})

test('formatProgressToolResultLine includes a concise result preview', () => {
  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'Read',
        input: {
          file_path: '/tmp/example.ts',
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
    'Read /tmp/example.ts (lines 1-2 of 20; starts with "export const value = 1")',
  )
})

test('formatVerboseLines includes tool result previews after tool calls', () => {
  const toolUse = createToolUseMessage('assistant', 'Read', {
    file_path: '/tmp/example.ts',
    offset: 1,
    limit: 2,
  })
  const toolUseId =
    toolUse.content[0]?.type === 'tool_use' ? toolUse.content[0].id : ''

  const lines = formatVerboseLines([
    createTextMessage('assistant', 'I will inspect the file first.'),
    toolUse,
    createToolResultMessage(
      'user',
      toolUseId,
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
  ])

  assert.deepEqual(lines, [
    '[content] I will inspect the file first.',
    'Reading /tmp/example.ts:1-2',
    'Read /tmp/example.ts:1-2 (lines 1-2 of 20; starts with "export const value = 1")',
  ])
})

test('formatProgressToolResultLine summarizes Edit and Bash results naturally', () => {
  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'Edit',
        input: {
          file_path: '/tmp/style.css',
        },
      },
      {
        ok: true,
        summary: 'Edited /tmp/style.css',
        output: {
          filePath: '/tmp/style.css',
          replaced: 2,
          content: '.app { color: red; }\n.button { color: blue; }\n',
        },
      },
    ),
    'Edit /tmp/style.css (updated 2 occurrences; now starts with ".app { color: red; }")',
  )

  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'Bash',
        input: {
          command: 'npx tsx --test test/unit/interactive-session.test.ts test/unit/verbose-events.test.ts',
        },
      },
      {
        ok: true,
        summary:
          'Ran npx tsx --test test/unit/interactive-session.test.ts test/unit/verbose-events.test.ts',
        output: {
          command:
            'npx tsx --test test/unit/interactive-session.test.ts test/unit/verbose-events.test.ts',
          stdout: '5 tests passed\nall good\n',
          stderr: '',
          exitCode: 0,
          interrupted: false,
        },
      },
    ),
    'Ran npx tsx --test test/unit/interactive-session.test.ts test/unit/verbose-events.test.ts (exit 0; 5 tests passed)',
  )
})

test('formatProgressToolResultLine summarizes search, fetch, and question results naturally', () => {
  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'Grep',
        input: {
          pattern: 'TODO',
          path: '/tmp/project/src',
        },
      },
      {
        ok: true,
        summary: 'Found 2 file(s)',
        output: {
          mode: 'content',
          numFiles: 2,
          totalFiles: 2,
          filenames: ['src/app.ts', 'src/lib.ts'],
          content: 'src/app.ts:12:// TODO tighten validation\nsrc/lib.ts:8:// TODO cache this\n',
          numLines: 2,
          totalLines: 2,
        },
      },
    ),
    'Searched "TODO" in /tmp/project/src (2 matches in 2 files; first hit: "src/app.ts:12:// TODO tighten validation")',
  )

  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'Glob',
        input: {
          pattern: '**/*.ts',
          path: '/tmp/project/src',
        },
      },
      {
        ok: true,
        summary: 'Found 3 file(s)',
        output: {
          filenames: ['src/app.ts', 'src/lib.ts', 'src/routes.ts'],
          numFiles: 3,
          totalFiles: 3,
        },
      },
    ),
    'Searched files matching "**/*.ts" in /tmp/project/src (3 files: src/app.ts, src/lib.ts, src/routes.ts)',
  )

  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'WebFetch',
        input: {
          url: 'https://example.com/pricing',
          prompt: 'pricing',
        },
      },
      {
        ok: true,
        summary: 'Fetched https://example.com/pricing',
        output: {
          title: 'Pricing',
          result: [
            'Prompt: pricing',
            '',
            'Fetched from: https://example.com/pricing',
            'Status: 200 OK',
            'Content-Type: text/html',
            'Title: Pricing',
            '',
            'Relevant excerpts for the prompt:',
            '',
            'Starter costs $10/month and Pro costs $30/month.',
          ].join('\n'),
        },
      },
    ),
    'Fetched https://example.com/pricing for "pricing" (Pricing; Starter costs $10/month and Pro costs $30/month.)',
  )

  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'AskUserQuestion',
        input: {
          questions: [{ header: 'Plan', question: 'Which plan?', options: [] }],
        },
      },
      {
        ok: true,
        output: {
          answers: {
            plan_choice: 'Option A',
          },
        },
      },
    ),
    'Asked 1 question (Plan) (answered: plan_choice=Option A)',
  )
})

test('formatProgressToolResultLine surfaces subagent wait results clearly', () => {
  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'Agent',
        input: {
          action: 'wait',
          agent_id: 'lesson-analyzer',
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
    'Subagent lesson-analyzer completed (analyzed lesson1)',
  )
})

test('formatProgressToolUseLine uses in-progress phrasing for subagent actions', () => {
  assert.equal(
    formatProgressToolUseLine({
      name: 'Agent',
      input: {
        action: 'spawn',
        agent_id: 'lesson1-analyzer',
        task: '分析lesson1的需求文档和代码实现是否匹配',
      },
    }),
    'Starting subagent lesson1-analyzer for "分析lesson1的需求文档和代码实现是否匹配"',
  )

  assert.equal(
    formatProgressToolUseLine({
      name: 'Agent',
      input: {
        action: 'wait',
        agent_id: 'lesson1-analyzer',
      },
    }),
    'Waiting for subagent lesson1-analyzer',
  )
})

test('formatProgressToolResultLine surfaces subagent spawn status as a state update', () => {
  assert.equal(
    formatProgressToolResultLine(
      {
        name: 'Agent',
        input: {
          action: 'spawn',
          agent_id: 'lesson1-analyzer',
          task: '分析lesson1的需求文档和代码实现是否匹配',
        },
      },
      {
        ok: true,
        summary:
          'Subagent lesson1-analyzer queued: 分析lesson1的需求文档和代码实现是否匹配',
        output: {
          action: 'spawn',
          agent: {
            agent_id: 'lesson1-analyzer',
            status: 'queued',
            task: '分析lesson1的需求文档和代码实现是否匹配',
          },
        },
      },
    ),
    'Subagent lesson1-analyzer queued',
  )
})
