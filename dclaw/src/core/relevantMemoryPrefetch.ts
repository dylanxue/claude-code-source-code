import type { Message } from '../types/message.js'
import type { QueryTraceSink } from './queryTrace.js'

export type RelevantMemoryRecentTool = {
  name: string
  ok: boolean
  summary?: string
}

export type RelevantMemoryPrefetchResult = {
  messages: Message[]
  recalledPaths: string[]
  recalledBytes: number
  skippedAlreadySurfacedCount: number
  skippedBySessionByteLimitCount: number
}

export type RelevantMemoryPrefetchHandle = {
  getSettled: () => RelevantMemoryPrefetchResult | undefined
  abort: () => void
}

export type RelevantMemoryPrefetcher = (state: {
  userPrompt: string
  recentTools: RelevantMemoryRecentTool[]
  abortSignal?: AbortSignal
  queryTraceSink?: QueryTraceSink
}) => RelevantMemoryPrefetchHandle | undefined
