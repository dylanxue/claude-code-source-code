import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { createSession } from '../../src/session/store.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import {
  createMessage,
  createTextMessage,
} from '../../src/types/message.js'
import type { TaskBoard } from '../../src/taskboard/types.js'
import { createToolContext } from '../helpers/toolContext.js'

class TaskCreateThenListClient implements LlmClient {
  readonly providerName = 'task-snapshot-test'
  readonly requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    if (this.requests.length === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_task_create',
            name: 'TaskCreate',
            input: {
              board: {
                title: 'Snapshot behavior',
              },
              tasks: [
                {
                  subject: 'Create task board',
                  description: 'Create the initial task list.',
                },
                {
                  subject: 'Read task board',
                  description: 'Read the current task list.',
                },
                {
                  subject: 'Finish task board',
                  description: 'Finish the batch.',
                },
              ],
            },
          },
        ]),
      }
    }

    if (this.requests.length === 2) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_task_list',
            name: 'TaskList',
            input: {},
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'done'),
    }
  }
}

test('query loop emits task snapshots for TaskCreate but not TaskList', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-task-snapshot-'))
  const env = { ...process.env, HOME: homeDir }
  const originalEnv = process.env
  const registry = createDefaultToolRegistry()
  const client = new TaskCreateThenListClient()
  const toolResults: Array<{
    toolUseId: string
    taskBoard?: TaskBoard
  }> = []

  try {
    process.env = env
    const session = await createSession({
      cwd: '/tmp/project',
      mode: 'interactive',
      provider: 'stub',
      model: 'stub-model',
      sessionId: 'session-task-snapshot',
      env,
    })

    await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'track this work')],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        cwd: '/tmp/project',
        permissionMode: 'default',
        sessionId: session.sessionId,
      }),
      streamHandlers: {
        onToolResult(toolResult) {
          toolResults.push({
            toolUseId: toolResult.toolUseId,
            ...(toolResult.taskBoard
              ? { taskBoard: toolResult.taskBoard }
              : {}),
          })
        },
      },
    })
  } finally {
    process.env = originalEnv
    await rm(homeDir, { recursive: true, force: true })
  }

  assert.deepEqual(
    toolResults.map(result => result.toolUseId),
    ['tool_task_create', 'tool_task_list'],
  )
  assert.ok(toolResults[0]?.taskBoard)
  assert.equal(toolResults[0]?.taskBoard?.title, 'Snapshot behavior')
  assert.equal(toolResults[1]?.taskBoard, undefined)
})
