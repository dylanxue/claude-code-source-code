import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMemoryExtractionPrompt } from '../../src/memory/extractPrompt.js'

test('memory extraction prompt includes Claude Code-style no-save boundaries', () => {
  const prompt = buildMemoryExtractionPrompt({
    newMessageCount: 4,
    memoryDir: '/tmp/memory',
    existingMemories: [],
  })

  assert.match(prompt, /## What NOT to save in memory/)
  assert.match(prompt, /Anything already documented in `CLAUDE\.md` files\./)
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
