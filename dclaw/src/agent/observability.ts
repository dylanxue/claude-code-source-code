import { loadAgent, loadSessionAgentLinks } from './store.js'
import type { AgentStatus } from './types.js'

export type SessionSubagentSummary = {
  count: number
  queuedCount: number
  runningCount: number
  completedCount: number
  failedCount: number
  stoppedCount: number
  lastAgentId?: string
  lastStatus?: AgentStatus
  lastTask?: string
  lastSummary?: string
  lastTracePath?: string
}

export async function loadSessionSubagentSummary(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionSubagentSummary> {
  const links = await loadSessionAgentLinks(sessionId, env)
  const summary: SessionSubagentSummary = {
    count: links.length,
    queuedCount: 0,
    runningCount: 0,
    completedCount: 0,
    failedCount: 0,
    stoppedCount: 0,
  }

  for (const link of links) {
    switch (link.status) {
      case 'queued':
        summary.queuedCount += 1
        break
      case 'running':
        summary.runningCount += 1
        break
      case 'completed':
        summary.completedCount += 1
        break
      case 'failed':
        summary.failedCount += 1
        break
      case 'stopped':
        summary.stoppedCount += 1
        break
    }
  }

  const lastLink = [...links].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0]
  if (!lastLink) {
    return summary
  }

  const lastAgent = await loadAgent(lastLink.agentId, sessionId, env)
  return {
    ...summary,
    lastAgentId: lastLink.agentId,
    lastStatus: lastLink.status,
    lastTask: lastLink.task,
    lastSummary: lastAgent?.summary,
    lastTracePath: lastAgent?.tracePath,
  }
}
