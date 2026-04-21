import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_IMAGE_MAX_SOURCE_BYTES,
  DEFAULT_READ_MAX_OUTPUT_TOKENS,
  DEFAULT_READ_MAX_SIZE_BYTES,
  getDefaultReadLimits,
} from '../../src/tools/builtin/readLimits.js'

test('read limits expose the shared defaults for text and image reads', () => {
  const limits = getDefaultReadLimits()

  assert.deepEqual(limits, {
    maxTokens: DEFAULT_READ_MAX_OUTPUT_TOKENS,
    maxSizeBytes: DEFAULT_READ_MAX_SIZE_BYTES,
    maxImageSourceBytes: DEFAULT_IMAGE_MAX_SOURCE_BYTES,
  })
})
