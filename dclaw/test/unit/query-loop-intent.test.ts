import assert from 'node:assert/strict'
import test from 'node:test'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { buildTool } from '../../src/tools/types.js'
import {
  createMessage,
  createTextMessage,
  type Message,
} from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

type CapturedIntent = {
  source?: string
  text?: string
  currentUserRequest?: string
}

class IntentClient implements LlmClient {
  readonly providerName = 'intent-test'
  private callCount = 0

  constructor(private readonly firstAssistantMessage: Message) {}

  async createMessage(
    _request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.callCount += 1
    if (this.callCount === 1) {
      return {
        message: this.firstAssistantMessage,
      }
    }

    return {
      message: createTextMessage('assistant', 'done'),
    }
  }
}

function createCaptureTool(captured: CapturedIntent) {
  return buildTool({
    name: 'CaptureIntent',
    description: 'Capture the current tool-use intent for testing.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
      additionalProperties: false,
    },
    isReadOnly() {
      return true
    },
    async call(_input, context) {
      captured.source = context.toolUseIntent?.source
      captured.text = context.toolUseIntent?.text
      captured.currentUserRequest = context.currentUserRequest
      return {
        ok: true,
        output: {
          ok: true,
        },
      }
    },
  })
}

function createRegistry(captured: CapturedIntent): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(createCaptureTool(captured))
  return registry
}

test('query loop prefers assistant text when deriving tool-use intent', async () => {
  const captured: CapturedIntent = {}
  const registry = createRegistry(captured)

  await executeSingleTurn({
    client: new IntentClient(
      createMessage('assistant', [
        {
          type: 'reasoning',
          summary: ['Need to inspect the screenshot carefully.'],
        },
        {
          type: 'text',
          text: 'I will inspect the screenshot for color and glow details.',
        },
        {
          type: 'tool_use',
          id: 'tool_capture_intent_text',
          name: 'CaptureIntent',
          input: {},
        },
      ]),
    ),
    messages: [createTextMessage('user', '参考这张图做一个风格相近的 hero section')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['CaptureIntent'],
    }),
  })

  assert.equal(captured.source, 'assistant_text')
  assert.match(captured.text ?? '', /color and glow details/i)
  assert.match(captured.currentUserRequest ?? '', /风格相近/)
})

test('query loop falls back to reasoning when assistant text is absent', async () => {
  const captured: CapturedIntent = {}
  const registry = createRegistry(captured)

  await executeSingleTurn({
    client: new IntentClient(
      createMessage('assistant', [
        {
          type: 'reasoning',
          summary: ['Need to inspect the screenshot for blue highlight effects.'],
        },
        {
          type: 'tool_use',
          id: 'tool_capture_intent_reasoning',
          name: 'CaptureIntent',
          input: {},
        },
      ]),
    ),
    messages: [createTextMessage('user', '请看一下这张图的视觉风格')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['CaptureIntent'],
    }),
  })

  assert.equal(captured.source, 'reasoning')
  assert.match(captured.text ?? '', /blue highlight effects/i)
  assert.match(captured.currentUserRequest ?? '', /视觉风格/)
})

test('query loop falls back to the latest user request when assistant text and reasoning are absent', async () => {
  const captured: CapturedIntent = {}
  const registry = createRegistry(captured)

  await executeSingleTurn({
    client: new IntentClient(
      createMessage('assistant', [
        {
          type: 'tool_use',
          id: 'tool_capture_intent_user',
          name: 'CaptureIntent',
          input: {},
        },
      ]),
    ),
    messages: [createTextMessage('user', '请提取这张图片里的布局和风格信息')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['CaptureIntent'],
    }),
  })

  assert.equal(captured.source, 'user_request')
  assert.match(captured.text ?? '', /布局和风格信息/)
  assert.match(captured.currentUserRequest ?? '', /布局和风格信息/)
})

test('query loop ignores system reminders when finding the latest user request', async () => {
  const captured: CapturedIntent = {}
  const registry = createRegistry(captured)

  await executeSingleTurn({
    client: new IntentClient(
      createMessage('assistant', [
        {
          type: 'tool_use',
          id: 'tool_capture_intent_after_reminder',
          name: 'CaptureIntent',
          input: {},
        },
      ]),
    ),
    messages: [
      createTextMessage('user', '使用Playwright搜索"平安科技"并且截图'),
      createTextMessage(
        'user',
        '<system-reminder>\nApply the playwright skill while continuing the current task.\n</system-reminder>',
      ),
    ],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['CaptureIntent'],
    }),
  })

  assert.equal(captured.source, 'user_request')
  assert.match(captured.text ?? '', /平安科技/)
  assert.match(captured.currentUserRequest ?? '', /平安科技/)
  assert.doesNotMatch(captured.text ?? '', /system-reminder/)
  assert.doesNotMatch(captured.currentUserRequest ?? '', /system-reminder/)
})

test('query loop reuses recent assistant text when the current tool call has no local intent', async () => {
  const captured: CapturedIntent = {}
  const registry = createRegistry(captured)

  await executeSingleTurn({
    client: new IntentClient(
      createMessage('assistant', [
        {
          type: 'tool_use',
          id: 'tool_capture_intent_prior_assistant',
          name: 'CaptureIntent',
          input: {},
        },
      ]),
    ),
    messages: [
      createTextMessage('user', '使用Playwright搜索"平安科技"并且截图'),
      createTextMessage(
        'assistant',
        '截图已保存！让我确认文件并查看截图效果。',
      ),
      createTextMessage('user', ''),
    ],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: ['CaptureIntent'],
    }),
  })

  assert.equal(captured.source, 'assistant_text')
  assert.match(captured.text ?? '', /确认文件/)
  assert.match(captured.currentUserRequest ?? '', /平安科技/)
})
