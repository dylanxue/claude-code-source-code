import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFileQueryTraceSink, createQueryTraceFilePath } from '../../src/core/queryTrace.js'
import {
  createSubagentToolContext,
  createSubagentRuntime,
} from '../../src/agent/runtime.js'
import { drainAgentRuns } from '../../src/agent/scheduler.js'
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
import { loadSessionForResume } from '../../src/session/resume.js'
import {
  getSessionDir,
  getSessionAgentMessagesPath,
  getSessionAgentMetaPath,
  getProjectPlanBoardsDir,
} from '../../src/session/paths.js'
import { listSessionHistory } from '../../src/session/history.js'
import { createSession, appendSessionMessages, loadSessionMessages } from '../../src/session/store.js'
import { formatTranscript } from '../../src/session/transcript.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { agentTool } from '../../src/tools/builtin/agent.js'
import { createTextMessage } from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

class DelayedStubLlmClient extends StubLlmClient {
  override async createMessage(
    ...args: Parameters<StubLlmClient['createMessage']>
  ): ReturnType<StubLlmClient['createMessage']> {
    await new Promise(resolve => setTimeout(resolve, 100))
    return super.createMessage(...args)
  }
}

async function waitForAgentStatus(
  sessionId: string,
  agentId: string,
  expectedStatus: 'running' | 'completed' | 'failed' | 'stopped',
  env: NodeJS.ProcessEnv,
  timeoutMs: number = 2_000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const agent = await loadAgent(agentId, sessionId, env)
    if (agent?.status === expectedStatus) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const latest = await loadAgent(agentId, sessionId, env)
  assert.equal(latest?.status, expectedStatus)
}

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
        getSessionDir(session.sessionId, env),
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
    await drainAgentRuns(500)
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
        getSessionDir(session.sessionId, env),
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
    assert.equal(runtime.engine.getSessionId(), undefined)
    assert.equal(runtime.engine.getPermissionMode(), 'default')
    assert.equal(runtime.engine.getPlanFilePath(), '/tmp/project/PLAN.md')
    assert.equal(runtime.engine.getMessages().length, 1)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('subagent tool context strips session-bound UI tools and host hooks', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-context-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const agent = await createAgent({
      agentId: 'agent-context',
      parentSessionId: 'session-context',
      task: 'Inspect session-bound tool filtering',
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      permissionMode: 'default',
      availableTools: [
        'Read',
        'Edit',
        'Agent',
        'AskUserQuestion',
        'EnterPlanMode',
        'ExitPlanMode',
        'TaskCreate',
        'TaskList',
        'TaskGet',
        'TaskUpdate',
      ],
      env,
    })

    const context = createSubagentToolContext({
      agent,
      parent: {
        client: new StubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: '/tmp/project',
        permissionMode: 'default',
        availableTools: ['Read', 'Edit', 'TaskCreate'],
        planFilePath: '/tmp/project/PLAN.md',
        toolRegistry: new ToolRegistry(),
        askUserQuestions: async () => ({ decision: 'Approve' }),
      },
    })

    assert.equal(context.sessionId, undefined)
    assert.equal(context.askUserQuestions, undefined)
    assert.deepEqual(context.availableTools, ['Read', 'Edit'])
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('agent tool supports spawn, send, wait, and transcript-safe completion summaries', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-tool-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceDir = join(homeDir, 'workspace')
  const delegatedFile = join(workspaceDir, 'delegated.txt')

  try {
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(delegatedFile, 'delegated result', 'utf8')

    const session = await createSession({
      cwd: workspaceDir,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-tool',
      env,
    })
    const toolRegistry = createDefaultToolRegistry()
    const toolNames = toolRegistry.list().map(tool => tool.name)
    const context = createToolContext({
      sessionId: session.sessionId,
      activeTurnId: 'turn_parent_1',
      cwd: workspaceDir,
      availableTools: toolNames,
      permissionMode: 'default',
      agentRuntime: {
        client: new DelayedStubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: workspaceDir,
        permissionMode: 'default',
        availableTools: toolNames,
        toolRegistry,
        env,
        createQueryTraceSink: async (sessionId, tracePath) =>
          createFileQueryTraceSink(
            tracePath ?? createQueryTraceFilePath(env, sessionId),
            sessionId,
          ),
      },
    })

    const spawnResult = await agentTool.call(
      {
        action: 'spawn',
        task: 'Inspect a delegated file',
        message: `tool:Read file_path=${delegatedFile}`,
      },
      context,
    )
    const agentId = spawnResult.output.agent.agent_id

    assert.equal(spawnResult.output.agent.status, 'queued')
    assert.equal(spawnResult.newMessages?.[0]?.transcriptOnly, true)

    const firstWaitResult = await agentTool.call(
      {
        action: 'wait',
        agent_id: agentId,
      },
      context,
    )
    const firstTracePath = firstWaitResult.output.agent.trace_path

    assert.equal(firstWaitResult.ok, true)
    assert.equal(firstWaitResult.output.agent.status, 'completed')
    assert.match(firstWaitResult.output.result?.summary ?? '', /tool results: 1/)
    assert.match(
      firstWaitResult.output.result?.output_text ?? '',
      /delegated result/,
    )
    assert.ok(firstTracePath)
    assert.match(await readFile(firstTracePath!, 'utf8'), /turn\.start/)

    const sentResult = await agentTool.call(
      {
        action: 'send',
        agent_id: agentId,
        message: 'follow-up summary',
      },
      context,
    )

    assert.equal(sentResult.output.agent.status, 'queued')

    const secondWaitResult = await agentTool.call(
      {
        action: 'wait',
        agent_id: agentId,
      },
      context,
    )

    assert.equal(secondWaitResult.output.agent.status, 'completed')
    assert.match(
      secondWaitResult.output.result?.output_text ?? '',
      /follow-up summary/,
    )

    await appendSessionMessages(
      session.sessionId,
      [
        ...(spawnResult.newMessages ?? []),
        ...(firstWaitResult.newMessages ?? []),
        ...(secondWaitResult.newMessages ?? []),
      ],
      env,
    )

    const childSession = await loadAgentSession(session.sessionId, agentId, env)
    assert.equal(childSession?.messages.length, 6)

    const parentTranscript = formatTranscript(
      await loadSessionMessages(session.sessionId, env),
    )
    assert.ok(
      parentTranscript.some(line =>
        line.includes(`[subagent ${agentId}] spawned for task:`),
      ),
    )
    assert.ok(
      parentTranscript.some(line =>
        line.includes(`[subagent ${agentId}] completed:`),
      ),
    )

    const history = await listSessionHistory(workspaceDir, env)
    const historyEntry = history.find(
      entry => entry.meta.sessionId === session.sessionId,
    )
    assert.equal(historyEntry?.subagents.count, 1)
    assert.equal(historyEntry?.subagents.completedCount, 1)
    assert.equal(historyEntry?.subagents.lastStatus, 'completed')
    assert.ok(historyEntry?.subagents.lastTracePath)

    const resumed = await loadSessionForResume(session.sessionId, env)
    assert.equal(resumed?.subagents.count, 1)
    assert.equal(resumed?.subagents.lastStatus, 'completed')
    assert.ok(resumed?.subagents.lastTracePath)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('agent tool preserves caller-provided agent_id across spawn and wait', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-alias-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceDir = join(homeDir, 'workspace')
  const delegatedFile = join(workspaceDir, 'delegated.txt')

  try {
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(delegatedFile, 'alias result', 'utf8')

    const session = await createSession({
      cwd: workspaceDir,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-alias',
      env,
    })
    const toolRegistry = createDefaultToolRegistry()
    const toolNames = toolRegistry.list().map(tool => tool.name)
    const context = createToolContext({
      sessionId: session.sessionId,
      activeTurnId: 'turn_parent_alias',
      cwd: workspaceDir,
      availableTools: toolNames,
      permissionMode: 'default',
      agentRuntime: {
        client: new StubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: workspaceDir,
        permissionMode: 'default',
        availableTools: toolNames,
        toolRegistry,
        env,
      },
    })

    const spawnResult = await agentTool.call(
      {
        action: 'spawn',
        agent_id: 'lesson1-analyzer',
        task: 'Inspect lesson1',
        message: `tool:Read file_path=${delegatedFile}`,
      },
      context,
    )

    assert.equal(spawnResult.output.agent.agent_id, 'lesson1-analyzer')

    const waitResult = await agentTool.call(
      {
        action: 'wait',
        agent_id: 'lesson1-analyzer',
      },
      context,
    )

    assert.equal(waitResult.output.agent.agent_id, 'lesson1-analyzer')
    assert.equal(waitResult.output.agent.status, 'completed')
    assert.match(waitResult.output.result?.output_text ?? '', /alias result/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('agent spawn starts background execution before wait is called', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-background-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceDir = join(homeDir, 'workspace')
  const delegatedFile = join(workspaceDir, 'delegated.txt')

  try {
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(delegatedFile, 'background result', 'utf8')

    const session = await createSession({
      cwd: workspaceDir,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-background',
      env,
    })
    const toolRegistry = createDefaultToolRegistry()
    const toolNames = toolRegistry.list().map(tool => tool.name)
    const context = createToolContext({
      sessionId: session.sessionId,
      activeTurnId: 'turn_parent_background',
      cwd: workspaceDir,
      availableTools: toolNames,
      permissionMode: 'default',
      agentRuntime: {
        client: new StubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: workspaceDir,
        permissionMode: 'default',
        availableTools: toolNames,
        toolRegistry,
        env,
      },
    })

    const spawnResult = await agentTool.call(
      {
        action: 'spawn',
        agent_id: 'background-analyzer',
        task: 'Inspect in background',
        message: `tool:Read file_path=${delegatedFile}`,
      },
      context,
    )

    assert.equal(spawnResult.output.agent.agent_id, 'background-analyzer')
    await waitForAgentStatus(
      session.sessionId,
      'background-analyzer',
      'completed',
      env,
    )

    const backgroundAgent = await loadAgent(
      'background-analyzer',
      session.sessionId,
      env,
    )
    assert.equal(backgroundAgent?.status, 'completed')
    assert.match(backgroundAgent?.outputText ?? '', /background result/)
    assert.equal(
      (await loadAgentMessages(session.sessionId, 'background-analyzer', env))
        .length > 0,
      true,
    )

    const waitResult = await agentTool.call(
      {
        action: 'wait',
        agent_id: 'background-analyzer',
      },
      context,
    )
    assert.equal(waitResult.output.agent.status, 'completed')
    assert.match(waitResult.output.result?.output_text ?? '', /background result/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('agent send resumes background execution without requiring wait', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-send-background-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceDir = join(homeDir, 'workspace')
  const delegatedFile = join(workspaceDir, 'delegated.txt')

  try {
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(delegatedFile, 'initial result', 'utf8')

    const session = await createSession({
      cwd: workspaceDir,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-send-background',
      env,
    })
    const toolRegistry = createDefaultToolRegistry()
    const toolNames = toolRegistry.list().map(tool => tool.name)
    const context = createToolContext({
      sessionId: session.sessionId,
      activeTurnId: 'turn_parent_send_background',
      cwd: workspaceDir,
      availableTools: toolNames,
      permissionMode: 'default',
      agentRuntime: {
        client: new StubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: workspaceDir,
        permissionMode: 'default',
        availableTools: toolNames,
        toolRegistry,
        env,
      },
    })

    await agentTool.call(
      {
        action: 'spawn',
        agent_id: 'followup-analyzer',
        task: 'Inspect in background',
        message: `tool:Read file_path=${delegatedFile}`,
      },
      context,
    )
    await waitForAgentStatus(
      session.sessionId,
      'followup-analyzer',
      'completed',
      env,
    )

    const sendResult = await agentTool.call(
      {
        action: 'send',
        agent_id: 'followup-analyzer',
        message: 'follow-up summary',
      },
      context,
    )

    assert.equal(sendResult.output.agent.status, 'queued')
    await waitForAgentStatus(
      session.sessionId,
      'followup-analyzer',
      'completed',
      env,
    )

    const updatedAgent = await loadAgent(
      'followup-analyzer',
      session.sessionId,
      env,
    )
    assert.equal(updatedAgent?.status, 'completed')
    assert.match(updatedAgent?.outputText ?? '', /follow-up summary/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('subagent execution does not create top-level session or plan-board artifacts', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-boundary-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceDir = join(homeDir, 'workspace')

  try {
    await mkdir(workspaceDir, { recursive: true })

    const session = await createSession({
      cwd: workspaceDir,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-boundary',
      env,
    })
    const toolRegistry = createDefaultToolRegistry()
    const toolNames = toolRegistry.list().map(tool => tool.name)
    const context = createToolContext({
      sessionId: session.sessionId,
      activeTurnId: 'turn_parent_boundary',
      cwd: workspaceDir,
      availableTools: toolNames,
      permissionMode: 'default',
      agentRuntime: {
        client: new StubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: workspaceDir,
        permissionMode: 'default',
        availableTools: toolNames,
        toolRegistry,
        env,
      },
    })

    const waitResult = await agentTool.call(
      {
        action: 'spawn',
        agent_id: 'lesson-analyzer',
        task: 'Attempt session-bound UI work',
        message: 'tool:EnterPlanMode note=need_plan',
      },
      context,
    )

    assert.equal(waitResult.output.agent.agent_id, 'lesson-analyzer')
    await waitForAgentStatus(
      session.sessionId,
      'lesson-analyzer',
      'completed',
      env,
    )

    assert.deepEqual(
      await readdir(getProjectPlanBoardsDir(workspaceDir, env)).catch(() => []),
      [],
    )
    assert.deepEqual(
      await readdir(getSessionDir('lesson-analyzer', env)).catch(() => []),
      [],
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('agent tool stop preserves stopped status even if background execution already began', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-agent-stop-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceDir = join(homeDir, 'workspace')

  try {
    await mkdir(workspaceDir, { recursive: true })
    const session = await createSession({
      cwd: workspaceDir,
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-agent-stop',
      env,
    })
    const toolRegistry = createDefaultToolRegistry()
    const toolNames = toolRegistry.list().map(tool => tool.name)
    const context = createToolContext({
      sessionId: session.sessionId,
      activeTurnId: 'turn_parent_stop',
      cwd: workspaceDir,
      availableTools: toolNames,
      permissionMode: 'default',
      agentRuntime: {
        client: new StubLlmClient(),
        provider: 'stub',
        model: 'stub-model',
        cwd: workspaceDir,
        permissionMode: 'default',
        availableTools: toolNames,
        toolRegistry,
        env,
      },
    })

    const spawnResult = await agentTool.call(
      {
        action: 'spawn',
        task: 'Do not run this',
      },
      context,
    )
    const agentId = spawnResult.output.agent.agent_id

    const stopResult = await agentTool.call(
      {
        action: 'stop',
        agent_id: agentId,
      },
      context,
    )

    assert.equal(stopResult.output.agent.status, 'stopped')
    await drainAgentRuns(500)
  } finally {
    await drainAgentRuns(500)
    await rm(homeDir, { recursive: true, force: true })
  }
})
