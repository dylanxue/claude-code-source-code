import { finalizeExecutionTaskBoardForTurnEnd } from './store.js'
import type { TaskBoardEndReason } from './types.js'

export async function cleanupExecutionTaskBoardForTurnEnd(
  sessionId: string | undefined,
  reason: Exclude<TaskBoardEndReason, 'completed'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!sessionId) {
    return
  }

  await finalizeExecutionTaskBoardForTurnEnd(sessionId, reason, env)
}
