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
import type { Tool } from '../tools/types.js'

export type QueryLoopRequest = {
  client: LlmClient
  model?: string
  systemPrompt?: string
  messages: Message[]
  toolRegistry: ToolRegistry
  toolContext: ToolContext
  maxIterations?: number
  streamHandlers?: {
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
  }
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

function toToolDefinition(tool: Tool): {
  name: string
  description: string
  inputSchema: Record<string, unknown>
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? {
      type: 'object',
      additionalProperties: true,
    },
  }
}

function getAvailableTools(
  toolRegistry: ToolRegistry,
  context: ToolContext,
): Tool[] {
  return toolRegistry.list().filter(tool => {
    if (
      context.availableTools.length > 0 &&
      !context.availableTools.includes(tool.name)
    ) {
      return false
    }

    return tool.isEnabled ? tool.isEnabled(context) : true
  })
}

export async function executeSingleTurn(
  request: QueryLoopRequest,
): Promise<QueryLoopResult> {
  const maxIterations = request.maxIterations ?? 4
  const workingMessages = [...request.messages]
  const addedMessages: Message[] = []
  const availableTools = getAvailableTools(
    request.toolRegistry,
    request.toolContext,
  )
  const toolDefinitions = availableTools.map(toToolDefinition)

  let lastAssistantMessage: Message | undefined
  let lastToolResultMessages: Message[] = []
  let outputText = ''

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const streamedResponse =
      request.streamHandlers && request.client.createMessageStream
        ? await request.client.createMessageStream.call(
            request.client,
          {
            model: request.model,
            systemPrompt: request.systemPrompt,
            messages: workingMessages,
            tools: toolDefinitions,
          },
          {
            onTextDelta: text => {
              request.streamHandlers?.onTextDelta?.(text)
            },
          },
        )
        : await request.client.createMessage({
            model: request.model,
            systemPrompt: request.systemPrompt,
            messages: workingMessages,
            tools: toolDefinitions,
          })
    const assistantMessage = streamedResponse.message
    lastAssistantMessage = assistantMessage
    workingMessages.push(assistantMessage)
    addedMessages.push(assistantMessage)

    const toolUseBlocks = getToolUseBlocks(assistantMessage)
    for (const block of toolUseBlocks) {
      request.streamHandlers?.onToolUse?.({
        iteration,
        id: block.id,
        name: block.name,
        input: block.input,
      })
    }
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
        const toolResultMessage = createToolResultMessage('user', block.id, result)
        toolResultMessages.push(toolResultMessage)
        request.streamHandlers?.onToolResult?.({
          iteration,
          toolUseId: block.id,
          output: result,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool execution error'
        const toolResultMessage = createToolResultMessage('user', block.id, {
          error: message,
        })
        toolResultMessages.push(toolResultMessage)
        request.streamHandlers?.onToolResult?.({
          iteration,
          toolUseId: block.id,
          output: { error: message },
        })
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
