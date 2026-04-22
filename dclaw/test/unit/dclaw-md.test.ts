import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryEngine } from '../../src/core/queryEngine.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import {
  buildDclawMdReminderText,
  loadDclawMdEntries,
} from '../../src/prompt/dclawMd.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createTextMessage, getTextContent, type Message } from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

test('loadDclawMdEntries loads user DCLAW.md from DCLAW_HOME', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dclaw-dclaw-md-'))
  const projectDir = join(dir, 'project')
  const dclawHome = join(dir, 'custom-dclaw-home')
  const env = {
    ...process.env,
    HOME: join(dir, 'fake-home'),
    DCLAW_HOME: dclawHome,
  }

  try {
    await mkdir(projectDir, { recursive: true })
    await mkdir(dclawHome, { recursive: true })
    await writeFile(
      join(dclawHome, 'DCLAW.md'),
      'User instructions from DCLAW_HOME',
      'utf8',
    )
    await writeFile(join(projectDir, 'DCLAW.md'), 'Project instructions', 'utf8')

    const entries = await loadDclawMdEntries(projectDir, env)

    assert.equal(entries.length, 2)
    assert.equal(entries[0]?.source, 'user')
    assert.equal(entries[0]?.path, join(dclawHome, 'DCLAW.md'))
    assert.equal(entries[0]?.content, 'User instructions from DCLAW_HOME')
    assert.equal(entries[1]?.source, 'project')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('buildDclawMdReminderText wraps DCLAW.md entries as reminder context', () => {
  const text = buildDclawMdReminderText([
    {
      source: 'project',
      path: '/tmp/project/DCLAW.md',
      content: 'Follow the repository conventions.',
    },
  ])

  assert.ok(text)
  assert.match(text!, /As you answer the user's questions, you can use the following context:/)
  assert.match(text!, /# DCLAW\.md/)
  assert.match(text!, /## \[project\] \/tmp\/project\/DCLAW\.md/)
  assert.match(text!, /Follow the repository conventions\./)
  assert.match(text!, /may or may not be relevant/)
})

class CapturingLlmClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createTextMessage('assistant', 'ok'),
    }
  }
}

function findReminderMessages(request: CreateMessageRequest | undefined): Message[] {
  return (request?.messages ?? []).filter(message => {
    return (
      message.role === 'user' &&
      getTextContent(message).startsWith('<system-reminder>')
    )
  })
}

test('QueryEngine injects DCLAW.md as transient context', async () => {
  const client = new CapturingLlmClient()
  const registry = createDefaultToolRegistry()
  const engine = new QueryEngine({
    client,
    model: 'stub-model',
    systemPrompt: 'BASE SYSTEM PROMPT',
    dclawMdEntries: [
      {
        source: 'project',
        path: '/tmp/project/DCLAW.md',
        content: 'Follow the repository conventions.',
      },
    ],
    toolRegistry: registry,
    toolContext: createToolContext({
      cwd: '/tmp/project',
      sessionId: undefined,
      availableTools: registry.list().map(tool => tool.name),
    }),
  })

  await engine.submitUserPrompt('你好')

  const reminders = findReminderMessages(client.requests[0])
  assert.equal(reminders.length, 1)
  assert.match(getTextContent(reminders[0]!), /# DCLAW\.md/)

  assert.equal(
    engine.getMessages().some(message =>
      getTextContent(message).includes('# DCLAW.md'),
    ),
    false,
  )
})
