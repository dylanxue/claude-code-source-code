import { runAgentToCompletion } from './runner.js'
import type { ParentAgentRuntime } from './types.js'

type AgentRunResult = Awaited<ReturnType<typeof runAgentToCompletion>>

function buildRunKey(parentSessionId: string, agentId: string): string {
  return `${parentSessionId}:${agentId}`
}

const runningAgents = new Map<string, Promise<AgentRunResult>>()

export function getRunningAgentPromise(
  parentSessionId: string,
  agentId: string,
): Promise<AgentRunResult> | undefined {
  return runningAgents.get(buildRunKey(parentSessionId, agentId))
}

export function startAgentRun(
  agentId: string,
  parentSessionId: string,
  parent: ParentAgentRuntime,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentRunResult> {
  const key = buildRunKey(parentSessionId, agentId)
  const existing = runningAgents.get(key)
  if (existing) {
    return existing
  }

  const runPromise = runAgentToCompletion(agentId, parentSessionId, parent, env)
  runningAgents.set(key, runPromise)
  void runPromise.finally(() => {
    if (runningAgents.get(key) === runPromise) {
      runningAgents.delete(key)
    }
  })
  return runPromise
}

export async function drainAgentRuns(timeoutMs?: number): Promise<void> {
  if (runningAgents.size === 0) {
    return
  }

  const pending = Promise.allSettled(runningAgents.values()).then(() => undefined)
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
    await pending
    return
  }

  await Promise.race([
    pending,
    new Promise<void>(resolve => {
      const timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    }),
  ])
}
