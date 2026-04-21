export const DEFAULT_READ_MAX_OUTPUT_TOKENS = 25_000
export const DEFAULT_READ_MAX_SIZE_BYTES = 256 * 1024
export const DEFAULT_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024

export type ReadLimits = {
  maxTokens: number
  maxSizeBytes: number
  maxImageSourceBytes: number
}

export function getDefaultReadLimits(): ReadLimits {
  return {
    maxTokens: DEFAULT_READ_MAX_OUTPUT_TOKENS,
    maxSizeBytes: DEFAULT_READ_MAX_SIZE_BYTES,
    maxImageSourceBytes: DEFAULT_IMAGE_MAX_SOURCE_BYTES,
  }
}
