import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../../src/session/store.js'
import { loadSessionMessages } from '../../src/session/store.js'
import { createTextMessage } from '../../src/types/message.js'
import { runInteractiveSessionPrompt } from '../../src/cli/interactiveSession.js'

test('runInteractiveSessionPrompt shows coarse progress in default mode', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-'))
  const env = { ...process.env, HOME: homeDir }
  const session = await createSession({
    cwd: '/tmp/project',
    mode: 'interactive',
    provider: 'stub',
    model: 'stub-model',
    env,
  })
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  let submitUserPromptCalled = false
  let submitUserPromptWithHandlersCalled = false

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      submitUserPromptCalled = true
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      prompt: string,
      handlers?: {
        onAssistantMessage?: (message: {
          iteration: number
          id: string
          role: 'assistant'
          content: Array<
            | {
                type: 'reasoning'
                summary: string[]
                status?: string
              }
            | {
                type: 'text'
                text: string
              }
          >
        }) => void
        onToolUse?: (toolUse: {
          iteration: number
          id: string
          name: string
          input: Record<string, unknown>
        }) => void
        onToolResult?: (toolResult: {
          iteration: number
          toolUseId: string
          output: unknown
        }) => void
      },
    ) {
      submitUserPromptWithHandlersCalled = true
      assert.equal(prompt, 'inspect the file')
      handlers?.onAssistantMessage?.({
        iteration: 1,
        id: 'msg_reasoning',
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            summary: ['Inspect the file before editing it.'],
            status: 'completed',
          },
        ],
      })
      handlers?.onToolUse?.({
        iteration: 1,
        id: 'tool_read_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      })
      handlers?.onToolResult?.({
        iteration: 1,
        toolUseId: 'tool_read_1',
        output: {
          ok: true,
          output: { content: 'example' },
          summary: 'Read /tmp/example.txt',
        },
      })

      return {
        appendedMessages: [
          createTextMessage('user', prompt),
          createTextMessage('assistant', 'Final answer'),
        ],
        outputText: 'Final answer',
      }
    },
    getSessionId() {
      return session.sessionId
    },
    getMessages() {
      return this.messages
    },
  }

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    await runInteractiveSessionPrompt({
      engine: engine as never,
      sessionId: session.sessionId,
      prompt: 'inspect the file',
      stream: false,
      verbose: false,
      env,
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.equal(submitUserPromptCalled, false)
  assert.equal(submitUserPromptWithHandlersCalled, true)
  assert.match(text, /\[thinking\] Working on it\.\.\./)
  assert.match(text, /\[thinking\] Inspect the file before editing it\./)
  assert.match(text, /\[tool\] Read/)
  assert.match(text, /\[tool\] Read \/tmp\/example\.txt/)
  assert.match(text, /\[thinking\] Working on it\.\.\./)
  assert.match(text, /Final answer\n$/)
})

test('runInteractiveSessionPrompt persists partial turn messages before rethrowing errors', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-error-'))
  const env = { ...process.env, HOME: homeDir }
  const session = await createSession({
    cwd: '/tmp/project',
    mode: 'interactive',
    provider: 'stub',
    model: 'stub-model',
    env,
  })

  const userMessage = createTextMessage('user', 'continue')
  const assistantMessage = createTextMessage('assistant', 'I started working on it.')
  const engine = {
    messages: [] as Array<typeof userMessage>,
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers() {
      this.messages.push(userMessage, assistantMessage)
      throw new Error('network failed')
    },
    getSessionId() {
      return session.sessionId
    },
    getMessages() {
      return [...this.messages]
    },
  }

  try {
    await assert.rejects(
      runInteractiveSessionPrompt({
        engine: engine as never,
        sessionId: session.sessionId,
        prompt: 'continue',
        stream: true,
        verbose: false,
        env,
      }),
      /network failed/,
    )

    const storedMessages = await loadSessionMessages(session.sessionId, env)
    assert.equal(storedMessages.length, 2)
    assert.equal(storedMessages[0]?.role, 'user')
    assert.equal(storedMessages[1]?.role, 'assistant')
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
