import type { Message } from '../types/message.js'

export const MAX_IMAGE_BASE64_SIZE = 5 * 1024 * 1024

type OversizedImage = {
  index: number
  size: number
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export class ImageSizeError extends Error {
  constructor(oversizedImages: OversizedImage[], maxSize: number) {
    const first = oversizedImages[0]
    const message =
      oversizedImages.length === 1 && first
        ? `Image base64 payload (${formatBytes(first.size)}) exceeds the API limit (${formatBytes(maxSize)}).`
        : `${oversizedImages.length} images exceed the API limit (${formatBytes(maxSize)}): ${oversizedImages
            .map(image => `image ${image.index}=${formatBytes(image.size)}`)
            .join(', ')}.`

    super(message)
    this.name = 'ImageSizeError'
  }
}

export function hasImageContent(messages: Message[]): boolean {
  return messages.some(message =>
    message.content.some(block => block.type === 'image'),
  )
}

export function validateImagesForProvider(
  messages: Message[],
  maxSize: number = MAX_IMAGE_BASE64_SIZE,
): void {
  const oversizedImages: OversizedImage[] = []
  let imageIndex = 0

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'image') {
        continue
      }

      imageIndex += 1
      const size = block.source.data.length
      if (size > maxSize) {
        oversizedImages.push({
          index: imageIndex,
          size,
        })
      }
    }
  }

  if (oversizedImages.length > 0) {
    throw new ImageSizeError(oversizedImages, maxSize)
  }
}
