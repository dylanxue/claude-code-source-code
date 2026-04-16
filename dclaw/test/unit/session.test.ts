import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryEngine } from '../../src/core/queryEngine.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { loadSessionForResume } from '../../src/session/resume.js'
import {
  appendSessionMessages,
  createSession,
  loadSessionMessages,
} from '../../src/session/store.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { createTextMessage } from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

test('QueryEngine starts from initialMessages when resuming', async () => {
  const initialMessages = [
    createTextMessage('user', 'earlier prompt'),
    createTextMessage('assistant', 'earlier answer'),
  ]

  const engine = new QueryEngine({
    client: new StubLlmClient(),
    toolRegistry: new ToolRegistry(),
    toolContext: createToolContext(),
    initialMessages,
  })

  const result = await engine.submitUserPrompt('follow up prompt')

  assert.equal(result.messages.length, 4)
  assert.equal(result.messages[0]?.content[0]?.type, 'text')
  assert.equal(result.messages[2]?.role, 'user')
  assert.match(result.outputText, /follow up prompt/)
})

test('session store persists transcript messages for resume', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-session-'))
  const env = { ...process.env, HOME: homeDir }

  try {
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'print',
      provider: 'stub',
      model: 'stub-model',
      env,
    })

    const messages = [
      createTextMessage('user', 'hello'),
      createTextMessage('assistant', 'world'),
    ]

    await appendSessionMessages(session.sessionId, messages, env)

    const storedMessages = await loadSessionMessages(session.sessionId, env)
    const resumed = await loadSessionForResume(session.sessionId, env)

    assert.equal(storedMessages.length, 2)
    assert.equal(resumed?.meta.sessionId, session.sessionId)
    assert.equal(resumed?.meta.cwd, '/tmp/project')
    assert.equal(resumed?.messages.length, 2)
    assert.equal(resumed?.messages[1]?.role, 'assistant')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
