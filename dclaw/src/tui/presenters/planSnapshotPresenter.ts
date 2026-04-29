import type { PlanModeState } from '../../session/store.js'
import type { PlanModeSnapshot } from '../state/types.js'

export function presentPlanModeSnapshot(
  sessionId: string,
  planMode: PlanModeState,
): PlanModeSnapshot {
  return {
    sessionId,
    status: planMode.status,
    updatedAt: planMode.updatedAt ?? new Date().toISOString(),
    planFilePath: planMode.planFilePath,
    resumePermissionMode: planMode.resumePermissionMode,
  }
}
