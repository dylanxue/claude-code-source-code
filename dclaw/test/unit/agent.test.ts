import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSubagentRuntime,
} from '../../src/agent/runtime.js'
import {
  createAgent,
  listAgents,
  loadAgent,
  loadSessionAgentLinks,
  updateAgent,
} from '../../src/agent/store.js'
import {
  appendAgentMessages,
  loadAgentMessages,
  loadAgentSession,
} from '../../src/agent/session.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import {
  getSessionAgentMessagesPath,
  getSessionAgentMetaPath,
} from '../../src/session/paths.js'
import { createSession, appendSessionMessages, loadSessionMessages } from '../../src/session/store.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { createTextMessage } from '../../src/types/message.js'

test('agent store persists records and parent session links', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-store-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-parent',
      env,
    })

    const created = await createAgent({
      agentId: 'agent-child-1',
      parentSessionId: session.sessionId,
      parentTurnId: 'turn_1',
      task: 'Inspect the auth flow',
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      permissionMode: 'default',
      availableTools: ['Read', 'Grep'],
      maxTurns: 3,
      maxIterations: 7,
      env,
    })

    const loaded = await loadAgent(created.agentId, session.sessionId, env)
    const listed = await listAgents({ parentSessionId: session.sessionId, env })
    const links = await loadSessionAgentLinks(session.sessionId, env)

    assert.ok(loaded)
    assert.equal(loaded?.agentId, 'agent-child-1')
    assert.equal(loaded?.parentSessionId, session.sessionId)
    assert.equal(loaded?.parentTurnId, 'turn_1')
    assert.equal(loaded?.status, 'queued')
    assert.equal(loaded?.maxTurns, 3)
    assert.equal(loaded?.maxIterations, 7)
    assert.deepEqual(loaded?.availableTools, ['Read', 'Grep'])
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.agentId, 'agent-child-1')
    assert.equal(
      getSessionAgentMetaPath(session.sessionId, created.agentId, env),
      join(
        homeDir,
        '.dclaw',
        'sessions',
        session.sessionId,
        'subagents',
        `agent-${created.agentId}.meta.json`,
      ),
    )
    assert.deepEqual(links, [
      {
        parentTurnId: 'turn_1',
        agentId: 'agent-child-1',
        status: 'queued',
        task: 'Inspect the auth flow',
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    ])

    const completed = await updateAgent(
      created.agentId,
      session.sessionId,
      current => ({
        ...current,
        status: 'completed',
      }),
      env,
    )
    const updatedLinks = await loadSessionAgentLinks(session.sessionId, env)

    assert.equal(completed?.status, 'completed')
    assert.ok(completed?.completedAt)
    assert.equal(updatedLinks[0]?.status, 'completed')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('agent session keeps child messages separate from the parent session transcript', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-session-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-history',
      env,
    })
    await appendSessionMessages(
      session.sessionId,
      [createTextMessage('user', 'parent prompt')],
      env,
    )

    const agent = await createAgent({
      agentId: 'agent-child-history',
      parentSessionId: session.sessionId,
      parentTurnId: 'turn_2',
      task: 'Review config drift',
      cwd: '/tmp/project',
      provider: 'stub',
      permissionMode: 'default',
      availableTools: ['Read'],
      env,
    })

    await appendAgentMessages(
      session.sessionId,
      agent.agentId,
      [
        createTextMessage('user', 'child prompt'),
        createTextMessage('assistant', 'child answer'),
      ],
      env,
    )

    const parentMessages = await loadSessionMessages(session.sessionId, env)
    const childMessages = await loadAgentMessages(
      session.sessionId,
      agent.agentId,
      env,
    )
    const loaded = await loadAgentSession(session.sessionId, agent.agentId, env)

    assert.equal(parentMessages.length, 1)
    assert.equal(childMessages.length, 2)
    assert.equal(childMessages[0]?.role, 'user')
    assert.equal(childMessages[1]?.role, 'assistant')
    assert.equal(loaded?.messages.length, 2)
    assert.equal(loaded?.agent.agentId, agent.agentId)
    assert.equal(
      getSessionAgentMessagesPath(session.sessionId, agent.agentId, env),
      join(
        homeDir,
        '.dclaw',
        'sessions',
        session.sessionId,
        'subagents',
        `agent-${agent.agentId}.jsonl`,
      ),
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('subagent runtime inherits parent execution dependencies but keeps independent limits', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-runtime-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const agent = await createAgent({
      agentId: 'agent-runtime',
      parentSessionId: 'session-runtime',
      task: 'Summarize the repository layout',
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      permissionMode: 'default',
      availableTools: ['Read'],
      maxTurns: 4,
      maxIterations: 9,
      env,
    })

    const runtime = createSubagentRuntime({
      agent,
      parent: {
        client: new StubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: '/tmp/project',
        permissionMode: 'accept-edits',
        availableTools: ['Read', 'Edit'],
        planFilePath: '/tmp/project/PLAN.md',
        toolRegistry: new ToolRegistry(),
      },
      initialMessages: [createTextMessage('system', 'child context')],
    })

    assert.equal(runtime.maxTurns, 4)
    assert.equal(runtime.maxIterations, 9)
    assert.equal(runtime.engine.getSessionId(), 'agent-runtime')
    assert.equal(runtime.engine.getPermissionMode(), 'default')
    assert.equal(runtime.engine.getPlanFilePath(), '/tmp/project/PLAN.md')
    assert.equal(runtime.engine.getMessages().length, 1)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
