import {
  createImageBlock,
  createMessage,
  getTextContent,
} from '../types/message.js'
import type {
  ToolUseIntent,
  ToolRuntimeProfile,
} from '../types/tool.js'
import type { QueryTraceSink } from '../core/queryTrace.js'

const VISION_SIDE_QUERY_SYSTEM_PROMPT = [
  'You are assisting a text-only coding agent by analyzing an image.',
  'Return concise factual observations that help with the current objective.',
  'Do not write code, do not make implementation decisions, and do not invent details that are not visible.',
  'If something is uncertain, label it as uncertain.',
  'Use this exact structure:',
  'Visual findings',
  '- Visible text:',
  '- Style / mood:',
  '- Layout / composition:',
  '- UI elements / state cues:',
  '- Colors / typography / effects:',
  '- Uncertainties:',
].join('\n')

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars).trimEnd()}...`
}

function formatCurrentObjective(userRequest: string | undefined): string {
  const normalized = normalizeWhitespace(userRequest ?? '')
  return normalized.length > 0
    ? truncate(normalized, 800)
    : 'Not provided. Focus on observations that are most likely useful for the main coding task.'
}

function formatToolUseIntent(
  toolUseIntent: ToolUseIntent | undefined,
  userRequest: string | undefined,
): {
  source: ToolUseIntent['source']
  text: string
} {
  if (toolUseIntent) {
    return {
      source: toolUseIntent.source,
      text: truncate(normalizeWhitespace(toolUseIntent.text), 800),
    }
  }

  return {
    source: 'user_request',
    text: formatCurrentObjective(userRequest),
  }
}

function buildVisionSideQueryUserPrompt(input: {
  sourceLabel: string
  currentUserRequest?: string
  toolUseIntent?: ToolUseIntent
}): string {
  const currentObjective = formatCurrentObjective(input.currentUserRequest)
  const intent = formatToolUseIntent(
    input.toolUseIntent,
    input.currentUserRequest,
  )

  return [
    `Image source: ${input.sourceLabel}`,
    '',
    'Current objective:',
    currentObjective,
    '',
    `Why this image is being read now (${intent.source}):`,
    intent.text,
    '',
    'Return only observations that are relevant to the current objective.',
  ].join('\n')
}

export async function runVisionSideQuery(input: {
  runtime: NonNullable<ToolRuntimeProfile['imageFallback']>
  mediaType: string
  data: string
  sourceLabel: string
  currentUserRequest?: string
  toolUseIntent?: ToolUseIntent
  queryTraceSink?: QueryTraceSink
  iteration?: number
}): Promise<string> {
  const userPrompt = buildVisionSideQueryUserPrompt({
    sourceLabel: input.sourceLabel,
    currentUserRequest: input.currentUserRequest,
    toolUseIntent: input.toolUseIntent,
  })
  const traceIntent = formatToolUseIntent(
    input.toolUseIntent,
    input.currentUserRequest,
  )

  input.queryTraceSink?.record({
    event: 'vision_side_query.start',
    iteration: input.iteration,
    data: {
      provider: input.runtime.provider,
      model: input.runtime.model ?? 'default',
      sourceLabel: input.sourceLabel,
      mediaType: input.mediaType,
      imageBytesBase64: input.data.length,
      intentSource: traceIntent.source,
      intentPreview: truncate(traceIntent.text, 200),
      currentObjectivePreview: truncate(
        formatCurrentObjective(input.currentUserRequest),
        200,
      ),
    },
  })

  try {
    const response = await input.runtime.client.createMessage({
      model: input.runtime.model,
      systemPrompt: VISION_SIDE_QUERY_SYSTEM_PROMPT,
      messages: [
        createMessage('user', [
          {
            type: 'text',
            text: userPrompt,
          },
          createImageBlock(input.mediaType, input.data),
        ]),
      ],
    })

    const output = getTextContent(response.message).trim()
    const normalizedOutput = output.length > 0
      ? output
      : 'Visual findings\n- Visible text: none\n- Style / mood: uncertain\n- Layout / composition: uncertain\n- UI elements / state cues: uncertain\n- Colors / typography / effects: uncertain\n- Uncertainties: The vision side query returned no textual analysis.'

    input.queryTraceSink?.record({
      event: 'vision_side_query.complete',
      iteration: input.iteration,
      data: {
        provider: input.runtime.provider,
        model: input.runtime.model ?? 'default',
        sourceLabel: input.sourceLabel,
        outputChars: normalizedOutput.length,
        outputPreview: truncate(normalizedOutput, 240),
      },
    })

    return normalizedOutput
  } catch (error) {
    input.queryTraceSink?.record({
      event: 'vision_side_query.error',
      iteration: input.iteration,
      data: {
        provider: input.runtime.provider,
        model: input.runtime.model ?? 'default',
        sourceLabel: input.sourceLabel,
        errorName: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}
