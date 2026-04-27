import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { getMessagesAfterCompactBoundary } from '../../src/compact/boundaryMessage.js'
import { createFileQueryTraceSink, createQueryTraceFilePath } from '../../src/core/queryTrace.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import {
  appendSessionMessages,
  createSession,
  loadSessionMessages,
} from '../../src/session/store.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { createTextMessage } from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'
import { runInteractiveSessionPrompt } from '../../src/cli/interactiveSession.js'
import { readFile } from 'node:fs/promises'

function createLargeMessages(count: number, chunkLength: number) {
  const chunk = 'x'.repeat(chunkLength)
  return Array.from({ length: count }, (_, index) =>
    createTextMessage(
      index % 2 === 0 ? 'user' : 'assistant',
      `message ${index + 1} ${chunk}`,
    ),
  )
}

test('autocompact appends a boundary and follow-up messages in the current session', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-autocompact-'))
  const env = { ...process.env, HOME: homeDir }
  const sourceMessages = createLargeMessages(60, 7_000)

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'openai',
      model: 'kimi-k2',
      env,
    })
    await appendSessionMessages(session.sessionId, sourceMessages, env)

    const engine = new QueryEngine({
      client: new StubLlmClient(),
      provider: 'openai',
      modelLimitsEnv: env,
      model: 'kimi-k2',
      toolRegistry: new ToolRegistry(),
      toolContext: createToolContext({
        cwd: '/tmp/project',
        sessionId: session.sessionId,
      }),
      initialMessages: sourceMessages,
    })

    const result = await runInteractiveSessionPrompt({
      engine,
      sessionId: session.sessionId,
      prompt: 'follow up after autocompact',
      stream: false,
      env,
    })

    assert.ok(result.autoCompact)
    assert.equal(result.sessionId, session.sessionId)
    assert.equal(engine.getSessionId(), session.sessionId)

    const sessionMessages = await loadSessionMessages(result.sessionId, env)
    const visibleMessages = getMessagesAfterCompactBoundary(sessionMessages)

    assert.equal(result.autoCompact?.sessionId, session.sessionId)
    assert.match(result.autoCompact?.boundaryId ?? '', /^compact_/)
    assert.equal(sessionMessages.length, sourceMessages.length + 4)
    assert.equal(sessionMessages[60]?.compactBoundary?.boundaryId, result.autoCompact?.boundaryId)
    assert.equal(sessionMessages[61]?.id, result.autoCompact?.summaryMessageId)
    assert.equal(visibleMessages.length, 3)
    assert.equal(visibleMessages[1]?.role, 'user')
    assert.equal(visibleMessages[2]?.role, 'assistant')
    assert.match(
      visibleMessages[2]?.content[0]?.type === 'text'
        ? visibleMessages[2].content[0].text
        : '',
      /follow up after autocompact/,
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('autocompact failure falls back to the original session and records trace', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-autocompact-fallback-'))
  const brokenHomePath = join(homeDir, 'broken-home')
  const env = {
    ...process.env,
    HOME: homeDir,
    DCLAW_HOME: brokenHomePath,
    DCLAW_QUERY_TRACE: 'true',
  }
  const tracePath = createQueryTraceFilePath({
    ...process.env,
    HOME: homeDir,
    DCLAW_QUERY_TRACE: 'true',
  })
  const sourceMessages = createLargeMessages(60, 7_000)

  try {
    await writeFile(brokenHomePath, 'not-a-directory', 'utf8')
    const queryTraceSink = await createFileQueryTraceSink(tracePath)
    const sessionId = 'session-autocompact-fallback'

    const engine = new QueryEngine({
      client: new StubLlmClient(),
      provider: 'openai',
      modelLimitsEnv: env,
      model: 'kimi-k2',
      toolRegistry: new ToolRegistry(),
      toolContext: createToolContext({
        cwd: '/tmp/project',
        sessionId,
      }),
      initialMessages: sourceMessages,
      queryTraceSink,
    })

    const result = await engine.submitUserPrompt('continue without losing context')

    assert.equal(result.autoCompact, undefined)
    assert.equal(result.sessionId, sessionId)
    assert.equal(engine.getSessionId(), sessionId)
    assert.equal(result.appendedMessages[0]?.role, 'user')
    assert.equal(result.assistantMessage.role, 'assistant')

    const lines = (await readFile(tracePath, 'utf8'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { event: string; data?: Record<string, unknown> })

    assert.ok(lines.some(line => line.event === 'compact.auto.start'))
    assert.ok(lines.some(line => line.event === 'compact.auto.failure'))
    assert.ok(
      lines.some(
        line =>
          line.event === 'turn.start' ||
          line.event === 'turn.complete',
      ),
    )
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
