import type { LlmClient } from '../llm/types.js'
import {
  createToolResultMessage,
  getTextContent,
  getToolUseBlocks,
  type Message,
} from '../types/message.js'
import type { ToolContext } from '../types/tool.js'
import { evaluateToolPermission } from '../permissions/evaluator.js'
import type { ToolRegistry } from '../tools/registry.js'

export type QueryLoopRequest = {
  client: LlmClient
  model?: string
  systemPrompt?: string
  messages: Message[]
  toolRegistry: ToolRegistry
  toolContext: ToolContext
  maxIterations?: number
}

export type QueryLoopResult = {
  assistantMessage: Message
  toolResultMessages: Message[]
  addedMessages: Message[]
  outputText: string
  iterations: number
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value, null, 2)
}

export async function executeSingleTurn(
  request: QueryLoopRequest,
): Promise<QueryLoopResult> {
  const maxIterations = request.maxIterations ?? 4
  const workingMessages = [...request.messages]
  const addedMessages: Message[] = []

  let lastAssistantMessage: Message | undefined
  let lastToolResultMessages: Message[] = []
  let outputText = ''

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const response = await request.client.createMessage({
      model: request.model,
      systemPrompt: request.systemPrompt,
      messages: workingMessages,
    })

    const assistantMessage = response.message
    lastAssistantMessage = assistantMessage
    workingMessages.push(assistantMessage)
    addedMessages.push(assistantMessage)

    const toolUseBlocks = getToolUseBlocks(assistantMessage)
    if (toolUseBlocks.length === 0) {
      outputText = getTextContent(assistantMessage)
      return {
        assistantMessage,
        toolResultMessages: lastToolResultMessages,
        addedMessages,
        outputText,
        iterations: iteration,
      }
    }

    const toolResultMessages: Message[] = []
    for (const block of toolUseBlocks) {
      const tool = request.toolRegistry.get(block.name)
      if (!tool) {
        toolResultMessages.push(
          createToolResultMessage('user', block.id, {
            error: `Unknown tool: ${block.name}`,
          }),
        )
        continue
      }

      if (tool.isEnabled && !tool.isEnabled(request.toolContext)) {
        toolResultMessages.push(
          createToolResultMessage('user', block.id, {
            error: `Tool is disabled: ${block.name}`,
          }),
        )
        continue
      }

      if (tool.validate) {
        const validation = await tool.validate(block.input, request.toolContext)
        if (!validation.ok) {
          toolResultMessages.push(
            createToolResultMessage('user', block.id, {
              error: validation.error,
            }),
          )
          continue
        }
      }

      const permission = await evaluateToolPermission(
        tool,
        block.input,
        request.toolContext,
      )
      if (!permission.ok) {
        toolResultMessages.push(
          createToolResultMessage('user', block.id, {
            error: permission.error,
          }),
        )
        continue
      }

      try {
        const result = await tool.call(block.input, request.toolContext)
        toolResultMessages.push(
          createToolResultMessage('user', block.id, result),
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool execution error'
        toolResultMessages.push(
          createToolResultMessage('user', block.id, {
            error: message,
          }),
        )
      }
    }

    lastToolResultMessages = toolResultMessages
    workingMessages.push(...toolResultMessages)
    addedMessages.push(...toolResultMessages)
  }

  const fallbackToolText =
    lastToolResultMessages.length > 0
      ? lastToolResultMessages
          .map(message => {
            const block = message.content[0]
            if (!block || block.type !== 'tool_result') {
              return ''
            }
            return stringifyOutput(block.output)
          })
          .filter(text => text.length > 0)
          .join('\n\n')
      : ''

  return {
    assistantMessage:
      lastAssistantMessage ?? {
        id: 'msg_empty',
        role: 'assistant',
        createdAt: new Date().toISOString(),
        content: [],
      },
    toolResultMessages: lastToolResultMessages,
    addedMessages,
    outputText: outputText || fallbackToolText,
    iterations: maxIterations,
  }
}
