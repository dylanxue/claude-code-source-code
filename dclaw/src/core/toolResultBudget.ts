import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelLimits } from '../llm/modelLimits.js'
import { getToolResultsDir } from '../session/paths.js'
import type { Message, ToolResultContentBlock } from '../types/message.js'

export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000
export const DEFAULT_MAX_TOOL_RESULTS_PER_TURN_CHARS = 200_000
export const DEFAULT_PREVIEW_CHARS = 2_000
export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'
const APPROX_CHARS_PER_TOKEN = 4
const MAX_MODEL_AWARE_RESULT_SIZE_CHARS = 120_000
const MAX_MODEL_AWARE_TOOL_RESULTS_PER_TURN_CHARS = 500_000
const MIN_MODEL_AWARE_RESULT_SIZE_CHARS = 2_000
const MIN_MODEL_AWARE_TOOL_RESULTS_PER_TURN_CHARS = 8_000
const MIN_MODEL_AWARE_PREVIEW_CHARS = 500
const MAX_MODEL_AWARE_PREVIEW_CHARS = 8_000

export type PersistedToolResultOutput = {
  type: 'persisted_tool_result'
  toolName: string
  summary: string
  filepath: string
  originalSizeChars: number
  preview: string
  truncated: boolean
}

export type ToolResultBudgetMetadata = {
  toolName: string
  maxResultSizeChars: number
}

export type ToolResultBudgetOptions = {
  defaultMaxResultSizeChars?: number
  maxToolResultsPerTurnChars?: number
  previewChars?: number
  env?: NodeJS.ProcessEnv
}

export type ToolResultBudgetReplacement = {
  toolUseId: string
  toolName: string
  filepath: string
  originalSizeChars: number
}

export type ToolResultBudgetResult = {
  messages: Message[]
  replacements: ToolResultBudgetReplacement[]
}

export type ResolvedToolResultBudget = Required<
  Pick<
    ToolResultBudgetOptions,
    'defaultMaxResultSizeChars' | 'maxToolResultsPerTurnChars' | 'previewChars'
  >
>

export function resolveToolResultBudgetOptions(
  options: ToolResultBudgetOptions = {},
): Required<ToolResultBudgetOptions> {
  return {
    defaultMaxResultSizeChars:
      options.defaultMaxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS,
    maxToolResultsPerTurnChars:
      options.maxToolResultsPerTurnChars ??
      DEFAULT_MAX_TOOL_RESULTS_PER_TURN_CHARS,
    previewChars: options.previewChars ?? DEFAULT_PREVIEW_CHARS,
    env: options.env ?? process.env,
  }
}

type Candidate = {
  messageIndex: number
  blockIndex: number
  toolUseId: string
  toolName: string
  serializedOutput: string
  sizeChars: number
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function deriveToolResultBudgetFromModelLimits(
  limits: ModelLimits,
): ResolvedToolResultBudget {
  const estimatedInputBudgetTokens = Math.max(
    256,
    limits.contextWindow - limits.maxOutputTokens,
  )
  const estimatedInputBudgetChars =
    estimatedInputBudgetTokens * APPROX_CHARS_PER_TOKEN
  const defaultMaxResultSizeChars = clamp(
    Math.floor(estimatedInputBudgetChars * 0.1),
    MIN_MODEL_AWARE_RESULT_SIZE_CHARS,
    MAX_MODEL_AWARE_RESULT_SIZE_CHARS,
  )
  const maxToolResultsPerTurnChars = clamp(
    Math.floor(estimatedInputBudgetChars * 0.35),
    Math.max(
      MIN_MODEL_AWARE_TOOL_RESULTS_PER_TURN_CHARS,
      defaultMaxResultSizeChars * 2,
    ),
    MAX_MODEL_AWARE_TOOL_RESULTS_PER_TURN_CHARS,
  )
  const previewChars = clamp(
    Math.floor(defaultMaxResultSizeChars * 0.1),
    MIN_MODEL_AWARE_PREVIEW_CHARS,
    MAX_MODEL_AWARE_PREVIEW_CHARS,
  )

  return {
    defaultMaxResultSizeChars,
    maxToolResultsPerTurnChars,
    previewChars,
  }
}

export function isPersistedToolResultOutput(
  value: unknown,
): value is PersistedToolResultOutput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'persisted_tool_result'
  )
}

export function formatPersistedToolResultOutput(
  value: PersistedToolResultOutput,
): string {
  return [
    PERSISTED_OUTPUT_TAG,
    `Output too large (${value.originalSizeChars} chars). Full output saved to: ${value.filepath}`,
    '',
    `Preview (first ${value.preview.length} chars):`,
    value.preview,
    ...(value.truncated ? ['...'] : []),
    PERSISTED_OUTPUT_CLOSING_TAG,
  ].join('\n')
}

function getThreshold(
  metadata: ToolResultBudgetMetadata,
  defaultMaxResultSizeChars: number,
): number {
  if (!Number.isFinite(metadata.maxResultSizeChars)) {
    return defaultMaxResultSizeChars
  }

  return Math.min(metadata.maxResultSizeChars, defaultMaxResultSizeChars)
}

function buildPreview(serializedOutput: string, previewChars: number): string {
  if (serializedOutput.length <= previewChars) {
    return serializedOutput
  }

  return serializedOutput.slice(0, previewChars)
}

async function persistToolResult(
  toolName: string,
  serializedOutput: string,
  originalSizeChars: number,
  previewChars: number,
  env: NodeJS.ProcessEnv,
): Promise<PersistedToolResultOutput> {
  const directory = getToolResultsDir(env)
  await mkdir(directory, { recursive: true })

  const filepath = join(directory, `${randomUUID()}.txt`)
  await writeFile(filepath, serializedOutput, 'utf8')

  return {
    type: 'persisted_tool_result',
    toolName,
    summary: `${toolName} output exceeded the inline budget and was saved to disk`,
    filepath,
    originalSizeChars,
    preview: buildPreview(serializedOutput, previewChars),
    truncated: serializedOutput.length > previewChars,
  }
}

function replaceBlockOutput(
  message: Message,
  blockIndex: number,
  output: PersistedToolResultOutput,
): Message {
  return {
    ...message,
    content: message.content.map((block, index) =>
      index === blockIndex && block.type === 'tool_result'
        ? {
            ...block,
            output,
          }
        : block,
    ),
  }
}

function collectCandidates(
  messages: Message[],
  metadataByToolUseId: ReadonlyMap<string, ToolResultBudgetMetadata>,
): Candidate[] {
  const candidates: Candidate[] = []

  messages.forEach((message, messageIndex) => {
    if (message.role !== 'user') {
      return
    }

    message.content.forEach((block, blockIndex) => {
      if (
        block.type !== 'tool_result' ||
        isPersistedToolResultOutput(block.output)
      ) {
        return
      }

      const metadata = metadataByToolUseId.get(block.toolUseId)
      if (!metadata) {
        return
      }

      const serializedOutput = stringifyOutput(block.output)
      candidates.push({
        messageIndex,
        blockIndex,
        toolUseId: block.toolUseId,
        toolName: metadata.toolName,
        serializedOutput,
        sizeChars: serializedOutput.length,
      })
    })
  })

  return candidates
}

async function replaceCandidate(
  messages: Message[],
  candidate: Candidate,
  replacements: ToolResultBudgetReplacement[],
  options: Required<ToolResultBudgetOptions>,
): Promise<boolean> {
  const message = messages[candidate.messageIndex]
  const block = message?.content[candidate.blockIndex]
  if (!message || !block || block.type !== 'tool_result') {
    return false
  }

  try {
    const persistedOutput = await persistToolResult(
      candidate.toolName,
      candidate.serializedOutput,
      candidate.sizeChars,
      options.previewChars,
      options.env,
    )
    messages[candidate.messageIndex] = replaceBlockOutput(
      message,
      candidate.blockIndex,
      persistedOutput,
    )
    replacements.push({
      toolUseId: candidate.toolUseId,
      toolName: candidate.toolName,
      filepath: persistedOutput.filepath,
      originalSizeChars: candidate.sizeChars,
    })
    return true
  } catch {
    // Best effort only: if persistence fails, keep the original inline output.
    return false
  }
}

export async function applyToolResultBudget(
  messages: Message[],
  metadataByToolUseId: ReadonlyMap<string, ToolResultBudgetMetadata>,
  options: ToolResultBudgetOptions = {},
): Promise<ToolResultBudgetResult> {
  const resolvedOptions = resolveToolResultBudgetOptions(options)

  const nextMessages = [...messages]
  const replacements: ToolResultBudgetReplacement[] = []
  const candidates = collectCandidates(nextMessages, metadataByToolUseId)
  if (candidates.length === 0) {
    return { messages, replacements }
  }

  const replacedIds = new Set<string>()
  for (const candidate of candidates) {
    const metadata = metadataByToolUseId.get(candidate.toolUseId)
    if (!metadata) {
      continue
    }

    const threshold = getThreshold(
      metadata,
      resolvedOptions.defaultMaxResultSizeChars,
    )
    if (candidate.sizeChars <= threshold) {
      continue
    }

    if (
      await replaceCandidate(
        nextMessages,
        candidate,
        replacements,
        resolvedOptions,
      )
    ) {
      replacedIds.add(candidate.toolUseId)
    }
  }

  const remainingCandidates = candidates.filter(
    candidate => !replacedIds.has(candidate.toolUseId),
  )
  let totalSizeChars = remainingCandidates.reduce(
    (sum, candidate) => sum + candidate.sizeChars,
    0,
  )

  if (totalSizeChars > resolvedOptions.maxToolResultsPerTurnChars) {
    const sortedBySize = [...remainingCandidates].sort(
      (left, right) => right.sizeChars - left.sizeChars,
    )

    for (const candidate of sortedBySize) {
      if (totalSizeChars <= resolvedOptions.maxToolResultsPerTurnChars) {
        break
      }

      if (
        await replaceCandidate(
          nextMessages,
          candidate,
          replacements,
          resolvedOptions,
        )
      ) {
        totalSizeChars -= candidate.sizeChars
      }
    }
  }

  return replacements.length > 0
    ? { messages: nextMessages, replacements }
    : { messages, replacements }
}
