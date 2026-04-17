import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSystemPrompt } from '../../src/prompt/systemPrompt.js'
import { assemblePromptContext } from '../../src/prompt/contextAssembler.js'

test('buildSystemPrompt includes plan mode instructions and plan file context', () => {
  const prompt = buildSystemPrompt(
    assemblePromptContext({
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      mode: 'interactive',
      permissionMode: 'plan',
      plan: {
        boardId: 'board_123',
        status: 'active',
        planFilePath: '/tmp/.dclaw/plans/plan_board_123.md',
        currentTaskTitle: 'Implement planning state',
        currentStep: 'Writing the plan file scaffold',
        taskSummary: ['- [in_progress] Implement planning state'],
      },
    }),
  )

  assert.match(prompt, /# Planning State/)
  assert.match(prompt, /plan mode: active/)
  assert.match(prompt, /plan file: \/tmp\/.dclaw\/plans\/plan_board_123\.md/)
  assert.match(prompt, /only file you may edit during planning/)
  assert.match(prompt, /pending work summary:/)
})
