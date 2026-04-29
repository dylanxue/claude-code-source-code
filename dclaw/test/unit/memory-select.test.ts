import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextMessage } from '../../src/types/message.js'
import {
  parseSelectedMemoryPaths,
  selectRelevantMemoryEntries,
} from '../../src/memory/select.js'
import type { MemoryManifestEntry } from '../../src/memory/manifest.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'

function createEntry(
  relativePath: string,
  description: string,
): MemoryManifestEntry {
  return {
    name: relativePath,
    description,
    type: 'project',
    updatedAt: '2026-04-20T10:00:00.000Z',
    path: `/tmp/memory/${relativePath}`,
    relativePath,
    mtimeMs: Date.parse('2026-04-20T10:00:00.000Z'),
  }
}

class FixedResponseClient implements LlmClient {
  readonly providerName = 'capture'

  constructor(private readonly responseText: string) {}

  async createMessage(
    _request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    return {
      message: createTextMessage('assistant', this.responseText),
    }
  }
}

class CapturingSelectorClient implements LlmClient {
  readonly providerName = 'capture'
  request?: CreateMessageRequest

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.request = request
    return {
      message: createTextMessage(
        'assistant',
        '{"selected_memories":["project/auth-freeze.md"]}',
      ),
    }
  }
}

test('parseSelectedMemoryPaths accepts fenced JSON and filters unknown paths', () => {
  const selected = parseSelectedMemoryPaths(
    [
      '```json',
      '{"selected_memories":["project/known.md","project/unknown.md","project/known.md"]}',
      '```',
    ].join('\n'),
    new Set(['project/known.md']),
  )

  assert.deepEqual(selected, ['project/known.md'])
})

test('selectRelevantMemoryEntries returns only listed manifest entries', async () => {
  const entries = [
    createEntry('project/auth-freeze.md', 'Auth freeze begins on 2026-03-05.'),
    createEntry('project/latency-dashboard.md', 'Grafana dashboard for latency.'),
  ]
  const selected = await selectRelevantMemoryEntries({
    client: new FixedResponseClient(
      '{"selected_memories":["project/auth-freeze.md"]}',
    ),
    model: 'stub-model',
    query: 'When does the auth freeze start?',
    entries,
  })

  assert.equal(selected.length, 1)
  assert.equal(selected[0]?.relativePath, 'project/auth-freeze.md')
})

test('selectRelevantMemoryEntries stays empty on invalid JSON response', async () => {
  const entries = [
    createEntry('project/auth-freeze.md', 'Auth freeze begins on 2026-03-05.'),
  ]
  const selected = await selectRelevantMemoryEntries({
    client: new FixedResponseClient('not json'),
    query: 'auth freeze',
    entries,
  })

  assert.deepEqual(selected, [])
})

test('selectRelevantMemoryEntries includes recent tools in selector prompt', async () => {
  const client = new CapturingSelectorClient()
  const entries = [
    createEntry('project/auth-freeze.md', 'Auth freeze begins on 2026-03-05.'),
  ]

  await selectRelevantMemoryEntries({
    client,
    query: 'auth freeze',
    entries,
    recentTools: ['Read: ok | summary: inspected release plan'],
  })

  const requestText =
    client.request?.messages
      .map(message =>
        message.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n') ?? ''
  assert.match(requestText, /Recent tools:/)
  assert.match(requestText, /Read: ok/)
  assert.match(requestText, /inspected release plan/)
})
