import assert from 'node:assert/strict'
import test from 'node:test'
import { presentPlanModeSnapshot } from '../../src/tui/presenters/planSnapshotPresenter.js'

test('presentPlanModeSnapshot creates a compact plan-mode snapshot', () => {
  const planMode = {
    status: 'active' as const,
    resumePermissionMode: 'accept-edits' as const,
    planFilePath: '/tmp/project/docs/plan.md',
    updatedAt: '2026-04-29T00:01:00.000Z',
  }

  assert.deepEqual(presentPlanModeSnapshot('session_1', planMode), {
    sessionId: 'session_1',
    status: 'active',
    updatedAt: '2026-04-29T00:01:00.000Z',
    planFilePath: '/tmp/project/docs/plan.md',
    resumePermissionMode: 'accept-edits',
  })
})
