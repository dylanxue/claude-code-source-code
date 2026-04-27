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
  assert.match(text, /Assistant: Inspect the file before editing it\./)
  assert.match(text, /Tool: Reading \/tmp\/example\.txt/)
  assert.match(
    text,
    /Tool result: Read \/tmp\/example\.txt \(example\)/,
  )
  assert.match(text, /Assistant: Final answer\n$/)
})

test('runInteractiveSessionPrompt emits UI events for transcript rendering', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-ui-events-'))
  const env = { ...process.env, HOME: homeDir }
  const session = await createSession({
    cwd: '/tmp/project',
    mode: 'interactive',
    provider: 'stub',
    model: 'stub-model',
    env,
  })
  const events: Array<{ type: string; text?: string; prompt?: string }> = []

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in UI event mode')
    },
    async submitUserPromptWithHandlers(
      prompt: string,
      handlers?: {
        onTextDelta?: (text: string) => void
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
      assert.equal(prompt, 'inspect the file')
      handlers?.onTextDelta?.('Final')
      handlers?.onTextDelta?.(' answer')
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
    await runInteractiveSessionPrompt({
      engine: engine as never,
      sessionId: session.sessionId,
      prompt: 'inspect the file',
      stream: true,
      verbose: false,
      env,
      writeOutput() {},
      flushOutput() {},
      onUiEvent(event) {
        events.push({
          type: event.type,
          ...('text' in event ? { text: event.text } : {}),
          ...('prompt' in event ? { prompt: event.prompt } : {}),
        })
      },
    })
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }

  assert.deepEqual(
    events.map(event => event.type),
    [
      'turn_started',
      'assistant_text_delta',
      'assistant_text_delta',
      'tool_use_started',
      'tool_result_received',
      'turn_completed',
    ],
  )
  assert.equal(events[0]?.prompt, 'inspect the file')
  assert.equal(events[1]?.text, 'Final')
  assert.equal(events[2]?.text, ' answer')
})

test('runInteractiveSessionPrompt falls back to generic thinking only when no concrete progress appears quickly', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-generic-'))
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

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      _prompt: string,
      handlers?: {
        onToolResult?: (toolResult: {
          iteration: number
          toolUseId: string
          output: unknown
        }) => void
      },
    ) {
      await new Promise(resolve => setTimeout(resolve, 300))
      handlers?.onToolResult?.({
        iteration: 1,
        toolUseId: 'tool_read_1',
        output: {
          ok: true,
          summary: 'Read /tmp/example.txt',
          output: { content: 'example' },
        },
      })

      return {
        appendedMessages: [
          createTextMessage('user', 'inspect the file'),
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
  assert.match(text, /Working on it\.\.\./)
  assert.match(text, /Tool result: Read \/tmp\/example\.txt \(example\)/)
})

test('runInteractiveSessionPrompt shows reasoning progress when no tool result arrives', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-reasoning-'))
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

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      _prompt: string,
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
      },
    ) {
      handlers?.onAssistantMessage?.({
        iteration: 1,
        id: 'msg_reasoning',
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            summary: ['Inspecting the current implementation before answering.'],
            status: 'completed',
          },
        ],
      })

      return {
        appendedMessages: [
          createTextMessage('user', 'inspect the file'),
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
  assert.match(
    text,
    /Assistant: Inspecting the current implementation before answering\./,
  )
  assert.match(text, /Assistant: Final answer\n$/)
})

test('runInteractiveSessionPrompt prefers assistant text over reasoning when explaining a tool call', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-text-'))
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

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      _prompt: string,
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
            | {
                type: 'tool_use'
                id: string
                name: string
                input: Record<string, unknown>
              }
          >
        }) => void
        onToolUse?: (toolUse: {
          iteration: number
          id: string
          name: string
          input: Record<string, unknown>
        }) => void
      },
    ) {
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
          {
            type: 'text',
            text: 'Checking the current file before making any changes.',
          },
          {
            type: 'tool_use',
            id: 'tool_read_1',
            name: 'Read',
            input: { file_path: '/tmp/example.txt' },
          },
        ],
      })
      handlers?.onToolUse?.({
        iteration: 1,
        id: 'tool_read_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      })

      return {
        appendedMessages: [
          createTextMessage('user', 'inspect the file'),
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
  assert.match(
    text,
    /Assistant: Checking the current file before making any changes\./,
  )
  assert.doesNotMatch(text, /Assistant: Inspect the file before editing it\./)
  assert.match(text, /Tool: Reading \/tmp\/example\.txt/)
})

test('runInteractiveSessionPrompt preserves full assistant text before tool use', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-full-text-'))
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
  const progressText = [
    '现在我来检查一下 invoked_skills 附件，',
    '它在 compact 期间保留技能，',
    '这样 resume 时也能看到完整上下文。',
  ].join('\n')

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      _prompt: string,
      handlers?: {
        onAssistantMessage?: (message: {
          iteration: number
          id: string
          role: 'assistant'
          content: Array<
            | {
                type: 'text'
                text: string
              }
            | {
                type: 'tool_use'
                id: string
                name: string
                input: Record<string, unknown>
              }
          >
        }) => void
        onToolUse?: (toolUse: {
          iteration: number
          id: string
          name: string
          input: Record<string, unknown>
        }) => void
      },
    ) {
      handlers?.onAssistantMessage?.({
        iteration: 1,
        id: 'msg_tool_preface',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: progressText,
          },
          {
            type: 'tool_use',
            id: 'tool_read_1',
            name: 'Read',
            input: { file_path: '/tmp/example.txt' },
          },
        ],
      })
      handlers?.onToolUse?.({
        iteration: 1,
        id: 'tool_read_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      })

      return {
        appendedMessages: [
          createTextMessage('user', 'continue'),
          createTextMessage(
            'assistant',
            '检查完成。',
          ),
        ],
        outputText: '检查完成。',
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
      prompt: 'continue',
      stream: false,
      verbose: false,
      env,
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.match(
    text,
    /Assistant: 现在我来检查一下 invoked_skills 附件， 它在 compact 期间保留技能， 这样 resume 时也能看到完整上下文。\nTool: Reading \/tmp\/example\.txt/,
  )
})

test('runInteractiveSessionPrompt falls back to thinking when a tool call has no visible text', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-thinking-'))
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

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      _prompt: string,
      handlers?: {
        onAssistantMessage?: (message: {
          iteration: number
          id: string
          role: 'assistant'
          content: Array<
            | {
                type: 'thinking'
                thinking: string
              }
            | {
                type: 'tool_use'
                id: string
                name: string
                input: Record<string, unknown>
              }
          >
        }) => void
        onToolUse?: (toolUse: {
          iteration: number
          id: string
          name: string
          input: Record<string, unknown>
        }) => void
      },
    ) {
      handlers?.onAssistantMessage?.({
        iteration: 1,
        id: 'msg_thinking',
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'I will inspect the current skill implementation first.',
          },
          {
            type: 'tool_use',
            id: 'tool_read_1',
            name: 'Read',
            input: { file_path: '/tmp/example.txt' },
          },
        ],
      })
      handlers?.onToolUse?.({
        iteration: 1,
        id: 'tool_read_1',
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      })

      return {
        appendedMessages: [
          createTextMessage('user', 'inspect the file'),
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
  assert.match(
    text,
    /Assistant: I will inspect the current skill implementation first\./,
  )
  assert.match(text, /Tool: Reading \/tmp\/example\.txt/)
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

test('runInteractiveSessionPrompt does not print duplicate assistant text when outputText matches progress text', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-dedupe-'))
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

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      _prompt: string,
      handlers?: {
        onAssistantMessage?: (message: {
          iteration: number
          id: string
          role: 'assistant'
          content: Array<
            | {
                type: 'text'
                text: string
              }
            | {
                type: 'tool_use'
                id: string
                name: string
                input: Record<string, unknown>
              }
          >
        }) => void
        onToolUse?: (toolUse: {
          iteration: number
          id: string
          name: string
          input: Record<string, unknown>
        }) => void
      },
    ) {
      handlers?.onAssistantMessage?.({
        iteration: 1,
        id: 'msg_waiting',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '现在让我等待所有subagent完成分析：',
          },
          {
            type: 'tool_use',
            id: 'tool_wait_1',
            name: 'Agent',
            input: { action: 'wait', agent_id: 'lesson1-analyzer' },
          },
        ],
      })
      handlers?.onToolUse?.({
        iteration: 1,
        id: 'tool_wait_1',
        name: 'Agent',
        input: { action: 'wait', agent_id: 'lesson1-analyzer' },
      })

      return {
        appendedMessages: [
          createTextMessage('user', 'continue'),
          createTextMessage('assistant', '现在让我等待所有subagent完成分析：'),
        ],
        outputText: '现在让我等待所有subagent完成分析：',
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
      prompt: 'continue',
      stream: false,
      verbose: false,
      env,
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.equal(
    text.match(/Assistant: 现在让我等待所有subagent完成分析：/g)?.length ?? 0,
    1,
  )
  assert.doesNotMatch(text, /\n现在让我等待所有subagent完成分析：\n/)
  assert.match(text, /Tool: Waiting for subagent lesson1-analyzer/)
})

test('runInteractiveSessionPrompt does not duplicate streamed assistant text and restores Assistant prefixes across tool turns', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-interactive-session-stream-'))
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

  const firstText = '你好！我可以帮你处理 Rust 项目相关的任务。'
  const secondText = '你好！我看到这是一个 agent-study 项目。'

  const engine = {
    messages: [] as ReturnType<typeof createTextMessage>[],
    async submitUserPrompt() {
      throw new Error('submitUserPrompt should not be used in default mode')
    },
    async submitUserPromptWithHandlers(
      _prompt: string,
      handlers?: {
        onTextDelta?: (text: string) => void
        onAssistantMessage?: (message: {
          iteration: number
          id: string
          role: 'assistant'
          content: Array<
            | {
                type: 'text'
                text: string
              }
            | {
                type: 'tool_use'
                id: string
                name: string
                input: Record<string, unknown>
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
      handlers?.onTextDelta?.(firstText)
      handlers?.onAssistantMessage?.({
        iteration: 1,
        id: 'msg_1',
        role: 'assistant',
        content: [
          { type: 'text', text: firstText },
          {
            type: 'tool_use',
            id: 'tool_read_1',
            name: 'Read',
            input: { file_path: '/tmp/README.md' },
          },
        ],
      })
      handlers?.onToolUse?.({
        iteration: 1,
        id: 'tool_read_1',
        name: 'Read',
        input: { file_path: '/tmp/README.md' },
      })
      handlers?.onToolResult?.({
        iteration: 1,
        toolUseId: 'tool_read_1',
        output: {
          ok: true,
          output: { content: '# Agent Study' },
          summary: 'Read /tmp/README.md',
        },
      })

      handlers?.onTextDelta?.(secondText)
      handlers?.onAssistantMessage?.({
        iteration: 2,
        id: 'msg_2',
        role: 'assistant',
        content: [
          { type: 'text', text: secondText },
          {
            type: 'tool_use',
            id: 'tool_read_2',
            name: 'Read',
            input: { file_path: '/tmp/HANDOFF.md' },
          },
        ],
      })
      handlers?.onToolUse?.({
        iteration: 2,
        id: 'tool_read_2',
        name: 'Read',
        input: { file_path: '/tmp/HANDOFF.md' },
      })

      return {
        appendedMessages: [
          createTextMessage('user', '你好'),
          createTextMessage('assistant', secondText),
        ],
        outputText: secondText,
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
      prompt: '你好',
      stream: true,
      verbose: false,
      env,
    })
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    await rm(homeDir, { recursive: true, force: true })
  }

  const text = output.join('')
  assert.equal(text.match(/Assistant: 你好！我可以帮你处理 Rust 项目相关的任务。/g)?.length ?? 0, 1)
  assert.equal(text.match(/Assistant: 你好！我看到这是一个 agent-study 项目。/g)?.length ?? 0, 1)
  assert.doesNotMatch(text, /\n你好！我看到这是一个 agent-study 项目。\n/)
  assert.match(text, /Tool: Reading \/tmp\/README\.md/)
  assert.match(text, /Tool result: Read \/tmp\/README\.md \(# Agent Study\)/)
  assert.match(text, /Tool: Reading \/tmp\/HANDOFF\.md/)
})
