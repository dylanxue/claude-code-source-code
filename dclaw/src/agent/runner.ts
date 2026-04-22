import { createSubagentRuntime } from './runtime.js'
import { appendAgentMessages, loadAgentSession } from './session.js'
import { loadAgent, updateAgent } from './store.js'
import { buildAgentResultSummary } from './summary.js'
import type { AgentRecord, ParentAgentRuntime } from './types.js'
import type { Message } from '../types/message.js'

function countConversationTurns(messages: Message[]): number {
  return messages.filter(
    message =>
      message.role === 'user' &&
      message.content.some(
        block => block.type === 'text' || block.type === 'image',
      ),
  ).length
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

async function loadLatestAgentState(
  agentId: string,
  parentSessionId: string,
  env: NodeJS.ProcessEnv,
): Promise<AgentRecord | null> {
  return loadAgent(agentId, parentSessionId, env)
}

export async function runAgentToCompletion(
  agentId: string,
  parentSessionId: string,
  parent: ParentAgentRuntime,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  agent: AgentRecord
  messages: Message[]
}> {
  const loaded = await loadAgentSession(parentSessionId, agentId, env)
  if (!loaded) {
    throw new Error(`Subagent not found: ${agentId}`)
  }

  if (
    loaded.agent.status === 'completed' ||
    loaded.agent.status === 'failed' ||
    loaded.agent.status === 'stopped'
  ) {
    return loaded
  }

  const runtime = createSubagentRuntime({
    agent: loaded.agent,
    parent,
    initialMessages: loaded.messages,
  })

  let currentAgent =
    (await updateAgent(
      agentId,
      parentSessionId,
      agent => ({
        ...agent,
        status: 'running',
        completedAt: undefined,
        lastError: undefined,
      }),
      env,
    )) ?? loaded.agent
  let messages = [...loaded.messages]
  const queryTraceSink = await parent.createQueryTraceSink?.(
    currentAgent.agentId,
    currentAgent.tracePath,
  )

  if (queryTraceSink) {
    runtime.engine.setQueryTraceSink(queryTraceSink)
    if (
      queryTraceSink.filePath &&
      queryTraceSink.filePath !== currentAgent.tracePath
    ) {
      currentAgent =
        (await updateAgent(
          agentId,
          parentSessionId,
          agent => ({
            ...agent,
            tracePath: queryTraceSink.filePath,
          }),
          env,
        )) ?? currentAgent
    }
  }

  try {
    while (currentAgent.pendingPrompts.length > 0) {
      const latestAgent = await loadLatestAgentState(agentId, parentSessionId, env)
      if (latestAgent?.status === 'stopped') {
        return {
          agent: latestAgent,
          messages,
        }
      }

      if (countConversationTurns(runtime.engine.getMessages()) >= currentAgent.maxTurns) {
        throw new Error(
          `Subagent reached maxTurns (${currentAgent.maxTurns}) before finishing queued work.`,
        )
      }

      const prompt = currentAgent.pendingPrompts[0]!
      const result = await runtime.engine.submitUserPrompt(prompt)

      await appendAgentMessages(
        parentSessionId,
        agentId,
        result.appendedMessages,
        env,
      )
      messages.push(...result.appendedMessages)

      const remainingPrompts = currentAgent.pendingPrompts.slice(1)
      const latestAfterPrompt = await loadLatestAgentState(agentId, parentSessionId, env)
      if (latestAfterPrompt?.status === 'stopped') {
        return {
          agent: latestAfterPrompt,
          messages,
        }
      }

      const nextSummary =
        remainingPrompts.length === 0
          ? buildAgentResultSummary(messages, result.outputText)
          : currentAgent.summary
      const nextOutputText =
        remainingPrompts.length === 0
          ? normalizeText(result.outputText)
          : currentAgent.outputText

      currentAgent =
        (await updateAgent(
          agentId,
          parentSessionId,
          agent => ({
            ...(agent.status === 'stopped'
              ? agent
              : {
                  ...agent,
                  status: remainingPrompts.length === 0 ? 'completed' : 'running',
                  pendingPrompts: remainingPrompts,
                  summary: nextSummary,
                  outputText: nextOutputText,
                  completedAt:
                    remainingPrompts.length === 0
                      ? new Date().toISOString()
                      : undefined,
                  lastError: undefined,
                  tracePath:
                    runtime.engine.getQueryTracePath() ?? agent.tracePath,
                }),
          }),
          env,
        )) ?? currentAgent
      if (currentAgent.status === 'stopped') {
        return {
          agent: currentAgent,
          messages,
        }
      }
    }

    if (currentAgent.status !== 'completed') {
      const latestBeforeComplete = await loadLatestAgentState(
        agentId,
        parentSessionId,
        env,
      )
      if (latestBeforeComplete?.status === 'stopped') {
        return {
          agent: latestBeforeComplete,
          messages,
        }
      }

      currentAgent =
        (await updateAgent(
          agentId,
          parentSessionId,
          agent => ({
            ...(agent.status === 'stopped'
              ? agent
              : {
                  ...agent,
                  status: 'completed',
                  completedAt: new Date().toISOString(),
                  summary:
                    agent.summary ??
                    buildAgentResultSummary(messages, agent.outputText),
                }),
          }),
          env,
        )) ?? currentAgent
      if (currentAgent.status === 'stopped') {
        return {
          agent: currentAgent,
          messages,
        }
      }
    }

    return {
      agent: currentAgent,
      messages,
    }
  } catch (error) {
    const lastError =
      error instanceof Error ? error.message : 'Unknown subagent error'
    const latestBeforeFailure = await loadLatestAgentState(agentId, parentSessionId, env)
    if (latestBeforeFailure?.status === 'stopped') {
      return {
        agent: latestBeforeFailure,
        messages,
      }
    }

    currentAgent =
      (await updateAgent(
        agentId,
        parentSessionId,
        agent => ({
          ...agent,
          status: 'failed',
          completedAt: new Date().toISOString(),
          lastError,
          tracePath: runtime.engine.getQueryTracePath() ?? agent.tracePath,
        }),
        env,
      )) ?? currentAgent

    return {
      agent: currentAgent,
      messages,
    }
  } finally {
    await queryTraceSink?.flush().catch(() => undefined)
  }
}
