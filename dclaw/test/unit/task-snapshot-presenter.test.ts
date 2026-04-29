import assert from 'node:assert/strict'
import test from 'node:test'
import { presentTaskBoardSnapshot } from '../../src/tui/presenters/taskSnapshotPresenter.js'
import type { TaskBoard } from '../../src/taskboard/types.js'

test('presentTaskBoardSnapshot creates a complete transcript snapshot', () => {
  const board: TaskBoard = {
    boardId: 'taskboard_1',
    workspaceId: '/tmp/project',
    rootSessionId: 'session_1',
    latestSessionId: 'session_1',
    title: 'TUI rollout',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:01:00.000Z',
    executionState: 'active',
    currentTaskId: '2',
    tasks: [
      {
        id: '1',
        subject: 'Define snapshot state',
        description: 'Add state and events.',
        status: 'completed',
        blocks: [],
        blockedBy: [],
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:00:30.000Z',
      },
      {
        id: '2',
        subject: 'Render snapshot',
        description: 'Show tasks in transcript.',
        owner: 'codex',
        status: 'in_progress',
        blocks: [],
        blockedBy: ['1'],
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:01:00.000Z',
      },
    ],
  }

  assert.deepEqual(presentTaskBoardSnapshot(board), {
    boardId: 'taskboard_1',
    title: 'TUI rollout',
    executionState: 'active',
    updatedAt: '2026-04-29T00:01:00.000Z',
    completedCount: 1,
    totalCount: 2,
    currentTaskId: '2',
    tasks: [
      {
        id: '1',
        subject: 'Define snapshot state',
        status: 'completed',
        owner: undefined,
        blockedBy: [],
        isCurrent: false,
      },
      {
        id: '2',
        subject: 'Render snapshot',
        status: 'in_progress',
        owner: 'codex',
        blockedBy: ['1'],
        isCurrent: true,
      },
    ],
  })
})
