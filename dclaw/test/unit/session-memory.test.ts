import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactSession } from '../../src/compact/compactSession.js'
import { calculateSessionMemoryMessagesToKeep } from '../../src/compact/sessionMemoryCompact.js'
import { QueryEngine } from '../../src/core/queryEngine.js'
import {
  createSessionMemoryUpdater,
  SESSION_MEMORY_UPDATE_MESSAGE_THRESHOLD,
} from '../../src/sessionMemory/sessionMemory.js'
import { SESSION_MEMORY_TEMPLATE } from '../../src/sessionMemory/prompts.js'
import { getSessionMemoryPath } from '../../src/session/paths.js'
import {
  appendSessionMessages,
  createSession,
  loadSessionMessages,
  loadSessionMeta,
  updateSessionMeta,
} from '../../src/session/store.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import {
  createMessage,
  createTextMessage,
  createToolResultMessage,
  getTextContent,
} from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'

class SessionMemoryToolClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'read_notes',
            name: 'Read',
            input: {
              file_path: this.extractNotesPath(request.systemPrompt ?? ''),
            },
          },
        ]),
      }
    }
    if (this.requests.length === 2) {
      const notesPath = this.extractNotesPath(request.systemPrompt ?? '')
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'edit_notes',
            name: 'Edit',
            input: {
              file_path: notesPath,
              old_string: SESSION_MEMORY_TEMPLATE,
              new_string: [
                '# Session Memory',
                '',
                '## Current Goal',
                '- Continue the migration work.',
                '',
                '## Important Context',
                '- Use the staging database.',
                '',
                '## Decisions',
                '- Keep the notes concise.',
                '',
                '## Open Work',
                '- Verify migrations.',
                '',
                '## Files And Artifacts',
                '- src/db/migrate.ts',
                '',
              ].join('\n'),
            },
          },
        ]),
      }
    }

    return { message: createTextMessage('assistant', 'updated') }
  }

  private extractNotesPath(systemPrompt: string): string {
    const line = systemPrompt
      .split('\n')
      .find(value => value.endsWith('session-memory.md'))
    assert.ok(line)
    return line
  }
}

class CapturingCompactClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createTextMessage(
        'assistant',
        '<summary>compact summary from client</summary>',
      ),
    }
  }
}

function createLargeMessages(count: number, chunkLength: number) {
  const chunk = 'x'.repeat(chunkLength)
  return Array.from({ length: count }, (_, index) =>
    createTextMessage(
      index % 2 === 0 ? 'user' : 'assistant',
      `message ${index + 1} ${chunk}`,
    ),
  )
}

test('session memory updater creates and edits session-memory.md after threshold', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-update-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'stub',
      env,
    })
    const messages = Array.from(
      { length: SESSION_MEMORY_UPDATE_MESSAGE_THRESHOLD },
      (_, index) => createTextMessage(index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`),
    )
    const updater = createSessionMemoryUpdater({
      client: new SessionMemoryToolClient(),
      model: 'stub-model',
      env,
    })

    updater.scheduleUpdate({
      sessionId: session.sessionId,
      messages,
    })
    await updater.drainPendingUpdate(5_000)

    const notesPath = getSessionMemoryPath(session.sessionId, workspaceRoot, env)
    const content = await readFile(notesPath, 'utf8')
    const meta = await loadSessionMeta(session.sessionId, env)
    assert.match(content, /Continue the migration work/)
    assert.match(content, /src\/db\/migrate\.ts/)
    assert.equal(meta?.sessionMemory?.path, notesPath)
    assert.equal(meta?.sessionMemory?.coveredMessageId, messages.at(-1)?.id)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('session memory updater does not advance checkpoint on unsafe tool-use boundary', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-unsafe-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'stub',
      env,
    })
    const messages = [
      ...Array.from(
        { length: SESSION_MEMORY_UPDATE_MESSAGE_THRESHOLD - 1 },
        (_, index) => createTextMessage(index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`),
      ),
      createMessage('assistant', [
        {
          type: 'tool_use',
          id: 'tool_open',
          name: 'Read',
          input: { file_path: '/tmp/example.ts' },
        },
      ]),
    ]
    const updater = createSessionMemoryUpdater({
      client: new SessionMemoryToolClient(),
      model: 'stub-model',
      env,
    })

    updater.scheduleUpdate({
      sessionId: session.sessionId,
      messages,
    })
    await updater.drainPendingUpdate(5_000)

    const meta = await loadSessionMeta(session.sessionId, env)
    assert.equal(meta?.sessionMemory?.coveredMessageId, undefined)
    assert.ok(meta?.sessionMemory?.updatedAt)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession includes non-empty session memory in compact prompt', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-compact-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'stub',
      env,
    })
    const notesPath = getSessionMemoryPath(session.sessionId, workspaceRoot, env)
    await writeFile(
      notesPath,
      '# Session Memory\n\n## Current Goal\n- Finish the migration safely.\n',
      'utf8',
    )
    const client = new CapturingCompactClient()

    await compactSession({
      sourceSessionId: session.sessionId,
      messages: [createTextMessage('user', 'please continue')],
      cwd: workspaceRoot,
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      client,
      env,
    })

    const requestText = getTextContent(client.requests[0]!.messages[0]!)
    assert.match(requestText, /## Session Memory/)
    assert.match(requestText, /Finish the migration safely/)
    assert.match(requestText, new RegExp(notesPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession uses session memory checkpoint to compact only uncovered tail', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-tail-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'stub',
      env,
    })
    const notesPath = getSessionMemoryPath(session.sessionId, workspaceRoot, env)
    await writeFile(
      notesPath,
      '# Session Memory\n\n## Current Goal\n- Covered old migration context.\n',
      'utf8',
    )
    const messages = [
      createTextMessage('user', 'old covered request UNIQUE_OLD_CONTEXT'),
      createTextMessage('assistant', 'old covered answer'),
      createTextMessage('user', 'covered checkpoint message'),
      createTextMessage('assistant', `tail one ${'a'.repeat(4_000)}`),
      createTextMessage('user', `tail two ${'b'.repeat(4_000)}`),
      createTextMessage('assistant', `tail three ${'c'.repeat(4_000)}`),
    ]
    await updateSessionMeta(
      session.sessionId,
      meta => ({
        ...meta,
        sessionMemory: {
          path: notesPath,
          coveredMessageId: messages[2]!.id,
          coveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      env,
    )
    const client = new CapturingCompactClient()

    const result = await compactSession({
      sourceSessionId: session.sessionId,
      messages,
      cwd: workspaceRoot,
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      client,
      env,
    })

    const requestText = getTextContent(client.requests[0]!.messages[0]!)
    assert.doesNotMatch(requestText, /UNIQUE_OLD_CONTEXT/)
    assert.match(requestText, /tail one/)
    assert.match(requestText, /tail three/)
    assert.equal(result.messagesToKeep.length, 3)
    assert.equal(result.sessionMemoryCompact?.checkpointMessageId, messages[2]!.id)

    const sessionMessages = await loadSessionMessages(session.sessionId, env)
    assert.equal(sessionMessages.at(-3)?.id, messages[3]!.id)
    assert.equal(sessionMessages.at(-1)?.id, messages[5]!.id)

    const meta = await loadSessionMeta(session.sessionId, env)
    assert.equal(meta?.sessionMemory?.coveredMessageId, undefined)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession falls back to traditional compact when checkpoint is missing', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-missing-checkpoint-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'stub',
      env,
    })
    const notesPath = getSessionMemoryPath(session.sessionId, workspaceRoot, env)
    await writeFile(
      notesPath,
      '# Session Memory\n\n## Current Goal\n- Should not be used when checkpoint is stale.\n',
      'utf8',
    )
    await updateSessionMeta(
      session.sessionId,
      meta => ({
        ...meta,
        sessionMemory: {
          path: notesPath,
          coveredMessageId: 'missing-message-id',
          coveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      env,
    )
    const client = new CapturingCompactClient()

    await compactSession({
      sourceSessionId: session.sessionId,
      messages: [createTextMessage('user', 'full transcript survives fallback')],
      cwd: workspaceRoot,
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      client,
      env,
    })

    const requestText = getTextContent(client.requests[0]!.messages[0]!)
    assert.doesNotMatch(requestText, /Should not be used/)
    assert.match(requestText, /full transcript survives fallback/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('compactSession falls back to transcript when session memory is only template', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-template-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'stub',
      env,
    })
    await writeFile(
      getSessionMemoryPath(session.sessionId, workspaceRoot, env),
      SESSION_MEMORY_TEMPLATE,
      'utf8',
    )
    const client = new CapturingCompactClient()

    await compactSession({
      sourceSessionId: session.sessionId,
      messages: [createTextMessage('user', 'please continue')],
      cwd: workspaceRoot,
      provider: 'stub',
      model: 'stub-model',
      trigger: 'manual',
      client,
      env,
    })

    const requestText = getTextContent(client.requests[0]!.messages[0]!)
    assert.doesNotMatch(requestText, /## Session Memory/)
    assert.match(requestText, /## Transcript/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('QueryEngine waits for beforeCompactHook before auto compact', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-before-compact-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')
  const sourceMessages = createLargeMessages(60, 7_000)
  let hookCompleted = false

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'openai',
      model: 'kimi-k2',
      env,
    })
    await appendSessionMessages(session.sessionId, sourceMessages, env)
    const client = new CapturingCompactClient()
    const engine = new QueryEngine({
      client,
      provider: 'openai',
      modelLimitsEnv: env,
      model: 'kimi-k2',
      toolRegistry: new ToolRegistry(),
      toolContext: createToolContext({
        cwd: workspaceRoot,
        sessionId: session.sessionId,
      }),
      initialMessages: sourceMessages,
      beforeCompactHook: async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        hookCompleted = true
      },
    })

    await engine.submitUserPrompt('continue after compact')

    assert.equal(hookCompleted, true)
    assert.ok(client.requests.length >= 2)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('session memory path is restored from workspace-scoped session metadata', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-memory-path-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')

  try {
    const session = await createSession({
      cwd: workspaceRoot,
      mode: 'interactive',
      provider: 'stub',
      env,
    })
    const loaded = await loadSessionMeta(session.sessionId, env)

    assert.equal(loaded?.cwd, workspaceRoot)
    assert.equal(
      getSessionMemoryPath(session.sessionId, loaded!.cwd, env),
      getSessionMemoryPath(session.sessionId, env),
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('calculateSessionMemoryMessagesToKeep preserves tool-use pairs', () => {
  const covered = createTextMessage('assistant', 'covered')
  const toolUse = createMessage('assistant', [
    {
      type: 'tool_use',
      id: 'tool_pair',
      name: 'Read',
      input: { file_path: '/tmp/example.ts' },
    },
  ])
  const toolResult = createToolResultMessage('user', 'tool_pair', {
    ok: true,
  })
  const final = createTextMessage('assistant', 'done')

  const result = calculateSessionMemoryMessagesToKeep(
    [covered, toolUse, toolResult, final],
    toolUse.id,
    {
      minTokens: 0,
      minTextBlockMessages: 0,
      maxTokens: 1_000,
    },
  )

  assert.deepEqual(
    result.messagesToKeep.map(message => message.id),
    [toolUse.id, toolResult.id, final.id],
  )
})

test('calculateSessionMemoryMessagesToKeep preserves assistant message fragments', () => {
  const covered = createTextMessage('assistant', 'covered')
  const thinking = createMessage('assistant', [
    { type: 'thinking', thinking: 'need to inspect' },
  ])
  const toolUse = createMessage('assistant', [
    {
      type: 'tool_use',
      id: 'tool_fragment',
      name: 'Read',
      input: { file_path: '/tmp/example.ts' },
    },
  ])
  toolUse.id = thinking.id
  const toolResult = createToolResultMessage('user', 'tool_fragment', {
    ok: true,
  })

  const result = calculateSessionMemoryMessagesToKeep(
    [covered, thinking, toolUse, toolResult],
    thinking.id,
    {
      minTokens: 0,
      minTextBlockMessages: 0,
      maxTokens: 1_000,
    },
  )

  assert.deepEqual(
    result.messagesToKeep.map(message => message.id),
    [thinking.id, toolUse.id, toolResult.id],
  )
})
