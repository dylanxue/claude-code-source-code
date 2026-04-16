import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import {
  canStartInteractiveRepl,
  runInteractiveReplLoop,
} from '../../src/cli/repl.js'

test('canStartInteractiveRepl requires both input and output to be TTYs', () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }

  input.isTTY = true
  output.isTTY = false
  assert.equal(canStartInteractiveRepl(input, output), false)

  output.isTTY = true
  assert.equal(canStartInteractiveRepl(input, output), true)
})

test('runInteractiveReplLoop runs initial prompt, skips blanks, and exits on /exit', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const prompts: string[] = []

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    initialPrompt: 'first prompt',
    input,
    output,
    onPrompt: async prompt => {
      prompts.push(prompt)
    },
  })

  input.write('\n')
  input.write('second prompt\n')
  input.write('/exit\n')
  input.end()

  await loop

  assert.deepEqual(prompts, ['first prompt', 'second prompt'])
})
