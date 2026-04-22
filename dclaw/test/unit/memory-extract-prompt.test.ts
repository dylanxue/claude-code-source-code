import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMemoryExtractionPrompt } from '../../src/memory/extractPrompt.js'

test('memory extraction prompt includes DCLAW-style no-save boundaries', () => {
  const prompt = buildMemoryExtractionPrompt({
    newMessageCount: 4,
    memoryDir: '/tmp/memory',
    existingMemories: [],
  })

  assert.match(prompt, /## What NOT to save in memory/)
  assert.match(prompt, /Anything already documented in `DCLAW\.md` files\./)
  assert.match(
    prompt,
    /Ephemeral task details: in-progress work, temporary state, current conversation context, step lists, or todo-style progress tracking\./,
  )
  assert.match(
    prompt,
    /Code patterns, conventions, architecture, file paths, or project structure\./,
  )
  assert.match(
    prompt,
    /These exclusions still apply even if the user explicitly asked you to remember something\./,
  )
})

test('memory extraction prompt keeps memory writes scoped to durable facts and index-only MEMORY.md updates', () => {
  const prompt = buildMemoryExtractionPrompt({
    newMessageCount: 3,
    memoryDir: '/tmp/memory',
    existingMemories: [],
  })

  assert.match(
    prompt,
    /Use only information from the recent conversation above\. Do not investigate the codebase or verify by reading unrelated files\./,
  )
  assert.match(
    prompt,
    /Update MEMORY\.md as an index only\. Each entry should stay short and point to the file\./,
  )
  assert.match(
    prompt,
    /Never store full memory content directly in MEMORY\.md\./,
  )
  assert.match(
    prompt,
    /If the user explicitly asked you to forget something, remove or update the relevant memory\./,
  )
})
