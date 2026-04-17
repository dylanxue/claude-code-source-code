import { createTextMessage, getTextContent } from '../types/message.js'
import type { LlmClient } from '../llm/types.js'
import {
  buildCompactUserPrompt,
  getCompactSystemPrompt,
  type BuildCompactPromptInput,
} from './prompt.js'

export type SummarizeCompactInput = BuildCompactPromptInput & {
  client: LlmClient
  model?: string
}

function extractSummaryBlock(text: string): string {
  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i)
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim()
  }

  return text.trim()
}

export async function summarizeCompactSession(
  input: SummarizeCompactInput,
): Promise<string> {
  const response = await input.client.createMessage({
    model: input.model,
    systemPrompt: getCompactSystemPrompt(),
    messages: [
      createTextMessage(
        'user',
        buildCompactUserPrompt({
          transcriptLines: input.transcriptLines,
          instructionText: input.instructionText,
          contextStats: input.contextStats,
        }),
      ),
    ],
  })
  const text = extractSummaryBlock(getTextContent(response.message))
  if (!text) {
    throw new Error('Compact summarization returned an empty summary')
  }
  return text
}
