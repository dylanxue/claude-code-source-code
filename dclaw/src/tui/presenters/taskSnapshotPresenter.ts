import type { TaskBoard } from '../../taskboard/types.js'
import type { TaskListSnapshot } from '../state/types.js'

export function presentTaskBoardSnapshot(board: TaskBoard): TaskListSnapshot {
  const completedCount = board.tasks.filter(
    task => task.status === 'completed',
  ).length

  return {
    boardId: board.boardId,
    title: board.title,
    executionState: board.executionState,
    updatedAt: board.updatedAt,
    completedCount,
    totalCount: board.tasks.length,
    currentTaskId: board.currentTaskId,
    tasks: board.tasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      blockedBy: task.blockedBy,
      isCurrent: task.id === board.currentTaskId,
    })),
  }
}
