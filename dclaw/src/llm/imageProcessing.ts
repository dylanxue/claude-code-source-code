import { MAX_IMAGE_BASE64_SIZE } from './imageValidation.js'

export const IMAGE_TARGET_RAW_SIZE = Math.floor((MAX_IMAGE_BASE64_SIZE * 3) / 4)
export const IMAGE_MAX_WIDTH = 2_000
export const IMAGE_MAX_HEIGHT = 2_000

export type ProcessedImage = {
  buffer: Buffer
  mediaType: string
  wasOptimized: boolean
  estimatedTokens: number
}

type SharpLike = typeof import('sharp')
type SharpModule = SharpLike & { default?: SharpLike }
type ImageDimensions = { width?: number; height?: number }

function normalizeMediaType(mediaType: string): string {
  const normalized = mediaType.toLowerCase()
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized
}

async function loadSharp(): Promise<SharpLike> {
  const module = (await import('sharp')) as SharpModule
  return module.default ?? module
}

async function renderVariant(
  sharp: SharpLike,
  inputBuffer: Buffer,
  mediaType: string,
  maxWidth: number,
  maxHeight: number,
  quality: number,
  originalDimensions?: ImageDimensions,
): Promise<ProcessedImage> {
  const normalizedMediaType = normalizeMediaType(mediaType)
  let pipeline = sharp(inputBuffer, { animated: false }).rotate()
  if (
    !originalDimensions?.width ||
    !originalDimensions?.height ||
    originalDimensions.width > maxWidth ||
    originalDimensions.height > maxHeight
  ) {
    pipeline = pipeline.resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  switch (normalizedMediaType) {
    case 'image/png':
      pipeline = pipeline.png({
        compressionLevel: 9,
        palette: true,
        quality: Math.max(40, quality),
      })
      break
    case 'image/webp':
      pipeline = pipeline.webp({ quality })
      break
    case 'image/jpeg':
      pipeline = pipeline.jpeg({ quality, mozjpeg: true })
      break
    case 'image/gif':
      pipeline = pipeline.png({
        compressionLevel: 9,
        palette: true,
        quality: Math.max(40, quality),
      })
      return {
        buffer: await pipeline.toBuffer(),
        mediaType: 'image/png',
        wasOptimized: true,
        estimatedTokens: 0,
      }
    default:
      return {
        buffer: inputBuffer,
        mediaType,
        wasOptimized: false,
        estimatedTokens: 0,
      }
  }

  return {
    buffer: await pipeline.toBuffer(),
    mediaType: normalizedMediaType,
    wasOptimized: true,
    estimatedTokens: 0,
  }
}

export function estimateImageTokensFromBuffer(buffer: Buffer): number {
  return Math.ceil(buffer.toString('base64').length * 0.125)
}

export function getMaxRawBytesForImageTokens(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens * 6))
}

function finalizeProcessedImage(image: Omit<ProcessedImage, 'estimatedTokens'>): ProcessedImage {
  return {
    ...image,
    estimatedTokens: estimateImageTokensFromBuffer(image.buffer),
  }
}

async function compressImageToBudget(
  sharp: SharpLike,
  inputBuffer: Buffer,
  maxBytes: number,
  preferredMediaType: string,
  originalDimensions?: ImageDimensions,
): Promise<ProcessedImage> {
  const normalizedMediaType = normalizeMediaType(preferredMediaType)
  const initialMaxDimension = Math.min(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
  let best = finalizeProcessedImage(
    await renderVariant(
      sharp,
      inputBuffer,
      normalizedMediaType,
      initialMaxDimension,
      initialMaxDimension,
      75,
      originalDimensions,
    ),
  )

  if (best.buffer.length <= maxBytes) {
    return best
  }

  const fallbacks = [
    { mediaType: normalizedMediaType, maxWidth: 1_600, maxHeight: 1_600, quality: 70 },
    { mediaType: normalizedMediaType, maxWidth: 1_200, maxHeight: 1_200, quality: 55 },
    { mediaType: 'image/jpeg', maxWidth: 1_200, maxHeight: 1_200, quality: 50 },
    { mediaType: 'image/jpeg', maxWidth: 800, maxHeight: 800, quality: 40 },
    { mediaType: 'image/jpeg', maxWidth: 400, maxHeight: 400, quality: 20 },
  ]

  for (const fallback of fallbacks) {
    const candidate = finalizeProcessedImage(
      await renderVariant(
        sharp,
        inputBuffer,
        fallback.mediaType,
        fallback.maxWidth,
        fallback.maxHeight,
        fallback.quality,
        originalDimensions,
      ),
    )
    if (candidate.buffer.length < best.buffer.length) {
      best = candidate
    }
    if (candidate.buffer.length <= maxBytes) {
      return candidate
    }
  }

  return best
}

export async function optimizeImageForModel(
  inputBuffer: Buffer,
  mediaType: string,
  options: {
    maxTokens: number
  },
): Promise<ProcessedImage> {
  const normalizedMediaType = normalizeMediaType(mediaType)
  const { maxTokens } = options
  if (inputBuffer.length === 0) {
    return {
      buffer: inputBuffer,
      mediaType: normalizedMediaType,
      wasOptimized: false,
      estimatedTokens: 0,
    }
  }

  try {
    const sharp = await loadSharp()
    const metadata = await sharp(inputBuffer, { animated: false }).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    const needsResize =
      width > IMAGE_MAX_WIDTH ||
      height > IMAGE_MAX_HEIGHT ||
      inputBuffer.length > IMAGE_TARGET_RAW_SIZE

    if (!needsResize) {
      const result = finalizeProcessedImage({
        buffer: inputBuffer,
        mediaType: normalizedMediaType,
        wasOptimized: false,
      })
      if (result.estimatedTokens <= maxTokens) {
        return result
      }
      return await compressImageToBudget(
        sharp,
        inputBuffer,
        Math.min(IMAGE_TARGET_RAW_SIZE, getMaxRawBytesForImageTokens(maxTokens)),
        normalizedMediaType,
        { width, height },
      )
    }

    const initialVariant = finalizeProcessedImage(
      await renderVariant(
        sharp,
        inputBuffer,
        normalizedMediaType,
        IMAGE_MAX_WIDTH,
        IMAGE_MAX_HEIGHT,
        80,
        { width, height },
      ),
    )
    if (
      initialVariant.buffer.length <= IMAGE_TARGET_RAW_SIZE &&
      initialVariant.estimatedTokens <= maxTokens
    ) {
      return initialVariant
    }

    return await compressImageToBudget(
      sharp,
      inputBuffer,
      Math.min(IMAGE_TARGET_RAW_SIZE, getMaxRawBytesForImageTokens(maxTokens)),
      normalizedMediaType,
      { width, height },
    )
  } catch {
    return finalizeProcessedImage({
      buffer: inputBuffer,
      mediaType: normalizedMediaType,
      wasOptimized: false,
    })
  }
}
