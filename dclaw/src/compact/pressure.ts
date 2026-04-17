import type { ContextStats } from '../core/contextStats.js'

export type CompactPressureLevel = 'low' | 'medium' | 'high'

export type CompactRecommendation = {
  level: CompactPressureLevel
  shouldCompact: boolean
  reasons: string[]
  tokenUsage: number
  reservedSummaryTokens?: number
  effectiveContextWindowTokens?: number
  autoCompactThresholdTokens?: number
  warningThresholdTokens?: number
  errorThresholdTokens?: number
  blockingLimitTokens?: number
  percentLeft?: number
  percentUsed?: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
}

const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100)
}

function formatPercent(value: number): string {
  return `${value}%`
}

function getReservedSummaryTokens(stats: ContextStats): number | undefined {
  if (typeof stats.modelMaxOutputTokens !== 'number') {
    return undefined
  }

  return Math.min(stats.modelMaxOutputTokens, MAX_OUTPUT_TOKENS_FOR_SUMMARY)
}

function getEffectiveContextWindowTokens(
  stats: ContextStats,
): number | undefined {
  const reservedSummaryTokens = getReservedSummaryTokens(stats)
  if (
    typeof stats.modelContextWindow !== 'number' ||
    reservedSummaryTokens === undefined
  ) {
    return undefined
  }

  return Math.max(0, stats.modelContextWindow - reservedSummaryTokens)
}

function buildUnknownRecommendation(stats: ContextStats): CompactRecommendation {
  return {
    level: 'low',
    shouldCompact: false,
    reasons: ['model limits are unavailable, so auto-compact thresholds are unknown'],
    tokenUsage: stats.approxTokens,
    isAboveWarningThreshold: false,
    isAboveErrorThreshold: false,
    isAboveAutoCompactThreshold: false,
    isAtBlockingLimit: false,
  }
}

export function evaluateCompactPressure(
  stats: ContextStats,
): CompactRecommendation {
  const effectiveContextWindowTokens = getEffectiveContextWindowTokens(stats)
  const reservedSummaryTokens = getReservedSummaryTokens(stats)

  if (
    effectiveContextWindowTokens === undefined ||
    effectiveContextWindowTokens <= 0
  ) {
    return buildUnknownRecommendation(stats)
  }

  const autoCompactThresholdTokens = Math.max(
    0,
    effectiveContextWindowTokens - AUTOCOMPACT_BUFFER_TOKENS,
  )
  const warningThresholdTokens = Math.max(
    0,
    autoCompactThresholdTokens - WARNING_THRESHOLD_BUFFER_TOKENS,
  )
  const errorThresholdTokens = Math.max(
    0,
    autoCompactThresholdTokens - ERROR_THRESHOLD_BUFFER_TOKENS,
  )
  const blockingLimitTokens = Math.max(
    0,
    effectiveContextWindowTokens - MANUAL_COMPACT_BUFFER_TOKENS,
  )
  const tokenUsage = stats.approxTokens
  const threshold =
    autoCompactThresholdTokens > 0
      ? autoCompactThresholdTokens
      : effectiveContextWindowTokens
  const percentLeft = clampPercent(
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )
  const percentUsed = clampPercent(
    Math.round((tokenUsage / effectiveContextWindowTokens) * 100),
  )
  const isAboveWarningThreshold = tokenUsage >= warningThresholdTokens
  const isAboveErrorThreshold = tokenUsage >= errorThresholdTokens
  const isAboveAutoCompactThreshold = tokenUsage >= autoCompactThresholdTokens
  const isAtBlockingLimit = tokenUsage >= blockingLimitTokens
  const reasons: string[] = []

  if (isAboveAutoCompactThreshold) {
    reasons.push(
      `estimated token usage reached the auto-compact threshold (${tokenUsage}/${autoCompactThresholdTokens})`,
    )
  } else if (isAboveWarningThreshold) {
    reasons.push(
      `estimated token usage is close to auto-compact (${percentLeft}% remaining)`,
    )
  }

  if (isAtBlockingLimit) {
    reasons.push(
      `estimated token usage is near the manual compact limit (${tokenUsage}/${blockingLimitTokens})`,
    )
  }

  const level: CompactPressureLevel =
    isAboveAutoCompactThreshold || isAtBlockingLimit
      ? 'high'
      : isAboveWarningThreshold
        ? 'medium'
        : 'low'

  return {
    level,
    shouldCompact: isAboveAutoCompactThreshold,
    reasons,
    tokenUsage,
    reservedSummaryTokens,
    effectiveContextWindowTokens,
    autoCompactThresholdTokens,
    warningThresholdTokens,
    errorThresholdTokens,
    blockingLimitTokens,
    percentLeft,
    percentUsed,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export function formatCompactRecommendationLines(
  recommendation: CompactRecommendation,
): string[] {
  const pressureLine =
    recommendation.percentLeft === undefined
      ? `compact pressure: ${recommendation.level} (thresholds unavailable)`
      : `compact pressure: ${recommendation.level} (${formatPercent(recommendation.percentLeft)} until auto-compact)`
  const tokensLine =
    recommendation.autoCompactThresholdTokens === undefined
      ? `compact tokens: ${recommendation.tokenUsage} used (model limits unavailable)`
      : `compact tokens: ${recommendation.tokenUsage}/${recommendation.autoCompactThresholdTokens} before auto-compact`
  const windowLine =
    recommendation.effectiveContextWindowTokens === undefined ||
    recommendation.autoCompactThresholdTokens === undefined ||
    recommendation.blockingLimitTokens === undefined
      ? undefined
      : `compact window: effective ${recommendation.effectiveContextWindowTokens}, auto-compact ${recommendation.autoCompactThresholdTokens}, blocking ${recommendation.blockingLimitTokens}`
  const thresholdLine =
    recommendation.warningThresholdTokens === undefined ||
    recommendation.errorThresholdTokens === undefined
      ? undefined
      : `compact thresholds: warning ${recommendation.warningThresholdTokens}, error ${recommendation.errorThresholdTokens}`

  return [
    pressureLine,
    `compact dry-run recommendation: ${recommendation.shouldCompact ? 'compact soon' : 'no immediate compact needed'}`,
    tokensLine,
    ...(windowLine ? [windowLine] : []),
    ...(thresholdLine ? [thresholdLine] : []),
    ...(recommendation.reasons.length > 0
      ? [`compact reasons: ${recommendation.reasons.join('; ')}`]
      : []),
  ]
}
