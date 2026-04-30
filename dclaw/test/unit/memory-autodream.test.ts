import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAutoDream } from '../../src/memory/autoDream.js'
import {
  getMemoryConsolidationLockPath,
  getMemoryConsolidationStatePath,
  getMemoryEntrypointPath,
  getMemoryFilePath,
} from '../../src/memory/paths.js'
import { ensureMemoryScaffold } from '../../src/memory/store.js'
import { createSession } from '../../src/session/store.js'
import {
  createMessage,
  createTextMessage,
} from '../../src/types/message.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'

class ConsolidatingClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []
  private memoryDir?: string

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    const assistantCount = request.messages.filter(
      message => message.role === 'assistant',
    ).length
    this.memoryDir ??= request.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n')
      .match(/Memory directory: (.+)/)?.[1]?.trim()

    const entrypointPath = this.memoryDir
      ? join(this.memoryDir, 'MEMORY.md')
      : '/placeholder'
    const memoryFilePath = this.memoryDir
      ? join(this.memoryDir, 'project', 'consolidated-context.md')
      : '/placeholder'

    if (assistantCount === 0) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_read_memory_index',
            name: 'Read',
            input: { file_path: entrypointPath },
          },
        ]),
      }
    }

    if (assistantCount === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_write_memory_file',
            name: 'Write',
            input: {
              file_path: memoryFilePath,
              content: [
                '---',
                'name: "Consolidated Context"',
                'description: "Durable context consolidated from recent sessions."',
                'type: project',
                'updated_at: 2026-04-30T00:00:00.000Z',
                '---',
                '',
                'Recent sessions agreed on this durable project context.',
                '',
              ].join('\n'),
            },
          },
          {
            type: 'tool_use',
            id: 'tool_write_memory_index',
            name: 'Write',
            input: {
              file_path: entrypointPath,
              content: [
                '# Memory',
                '',
                '- [Consolidated Context](project/consolidated-context.md) - Durable context consolidated from recent sessions.',
                '',
              ].join('\n'),
            },
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'consolidation complete'),
    }
  }
}

async function createWorkspaceSession(input: {
  workspaceRoot: string
  env: NodeJS.ProcessEnv
  sessionId: string
}) {
  return createSession({
    cwd: input.workspaceRoot,
    mode: 'interactive',
    provider: 'stub',
    model: 'stub-model',
    sessionId: input.sessionId,
    env: input.env,
  })
}

test('autoDream skips when minHours has not elapsed', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-autodream-hours-'))
  const workspaceRoot = join(homeDir, 'workspace')
  const env = { ...process.env, HOME: homeDir }

  try {
    await ensureMemoryScaffold(workspaceRoot, env)
    await writeFile(
      getMemoryConsolidationStatePath(workspaceRoot, env),
      JSON.stringify({ lastConsolidatedAt: new Date().toISOString() }),
      'utf8',
    )
    await createWorkspaceSession({ workspaceRoot, env, sessionId: 'session-a' })

    const client = new ConsolidatingClient()
    const autoDream = createAutoDream({
      client,
      workspaceRoot,
      env,
      config: { minHours: 24, minSessions: 1 },
    })

    const result = await autoDream.runAutoDream()

    assert.deepEqual(result, { triggered: false, reason: 'min_hours' })
    assert.equal(client.requests.length, 0)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('autoDream skips when minSessions has not been reached and excludes current session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-autodream-sessions-'))
  const workspaceRoot = join(homeDir, 'workspace')
  const env = { ...process.env, HOME: homeDir }

  try {
    await createWorkspaceSession({
      workspaceRoot,
      env,
      sessionId: 'current-session',
    })

    const client = new ConsolidatingClient()
    const autoDream = createAutoDream({
      client,
      workspaceRoot,
      env,
      config: { minHours: 0, minSessions: 1 },
    })

    const result = await autoDream.runAutoDream({
      currentSessionId: 'current-session',
    })

    assert.deepEqual(result, { triggered: false, reason: 'min_sessions' })
    assert.equal(client.requests.length, 0)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('autoDream skips while consolidation lock is held', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-autodream-lock-'))
  const workspaceRoot = join(homeDir, 'workspace')
  const env = { ...process.env, HOME: homeDir }

  try {
    await ensureMemoryScaffold(workspaceRoot, env)
    await mkdir(getMemoryConsolidationLockPath(workspaceRoot, env))
    await createWorkspaceSession({ workspaceRoot, env, sessionId: 'session-a' })

    const client = new ConsolidatingClient()
    const autoDream = createAutoDream({
      client,
      workspaceRoot,
      env,
      config: { minHours: 0, minSessions: 1 },
    })

    const result = await autoDream.runAutoDream()

    assert.deepEqual(result, { triggered: false, reason: 'lock_held' })
    assert.equal(client.requests.length, 0)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('autoDream triggers forked consolidation and records improved memory note', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-autodream-trigger-'))
  const workspaceRoot = join(homeDir, 'workspace')
  const env = { ...process.env, HOME: homeDir }

  try {
    await createWorkspaceSession({ workspaceRoot, env, sessionId: 'session-a' })
    const client = new ConsolidatingClient()
    const autoDream = createAutoDream({
      client,
      workspaceRoot,
      env,
      config: { minHours: 0, minSessions: 1 },
    })

    const result = await autoDream.runAutoDream()
    const memoryFile = await readFile(
      getMemoryFilePath(workspaceRoot, 'project/consolidated-context.md', env),
      'utf8',
    )
    const memoryIndex = await readFile(
      getMemoryEntrypointPath(workspaceRoot, env),
      'utf8',
    )
    const firstRequestText = client.requests[0]?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''

    assert.equal(result.triggered, true)
    assert.match(firstRequestText, /memory consolidation forked agent/)
    assert.match(firstRequestText, /Touched sessions: 1/)
    assert.match(memoryFile, /Recent sessions agreed/)
    assert.match(memoryIndex, /consolidated-context\.md/)
    if (result.triggered) {
      assert.equal(result.note.transcriptOnly, true)
      assert.match(result.note.content[0]?.type === 'text' ? result.note.content[0].text : '', /Improved 1 memory file/)
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
