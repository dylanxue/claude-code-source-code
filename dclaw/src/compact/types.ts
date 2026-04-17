export type CompactTrigger = 'manual' | 'auto'

export type CompactBoundary = {
  boundaryId: string
  createdAt: string
  trigger: CompactTrigger
  reason?: string
  messageCountBefore: number
  summaryMessageId: string
}

export function formatCompactBoundaryLabel(
  boundary: Pick<CompactBoundary, 'boundaryId' | 'trigger'>,
): string {
  return `${boundary.trigger} compact boundary ${boundary.boundaryId}`
}
