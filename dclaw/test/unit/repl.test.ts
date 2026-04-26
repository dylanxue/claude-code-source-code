import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import {
  canStartInteractiveRepl,
  runInteractiveReplLoop,
} from '../../src/cli/repl.js'

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function collectStreamOutput(stream: PassThrough): string[] {
  const chunks: string[] = []
  stream.on('data', chunk => {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
    )
  })
  return chunks
}

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

test('runInteractiveReplLoop reports prompt errors and keeps the REPL alive', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const prompts: string[] = []
  const errors: string[] = []

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    input,
    output,
    onPrompt: async prompt => {
      prompts.push(prompt)
      if (prompt === 'fail once') {
        throw new Error('stream timeout')
      }
    },
    onPromptError(error) {
      errors.push(error instanceof Error ? error.message : String(error))
    },
  })

  input.write('fail once\n')
  input.write('keep going\n')
  input.write('/exit\n')
  input.end()

  await loop

  assert.deepEqual(prompts, ['fail once', 'keep going'])
  assert.deepEqual(errors, ['stream timeout'])
})

test('runInteractiveReplLoop queues prompts while a response is active', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const outputChunks = collectStreamOutput(output)
  const prompts: string[] = []
  const queued: string[] = []
  let releaseFirstPrompt: (() => void) | undefined

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    input,
    output,
    onPrompt: async prompt => {
      prompts.push(prompt)
      if (prompt === 'first prompt') {
        await new Promise<void>(resolve => {
          releaseFirstPrompt = resolve
        })
      }
    },
    onPromptQueued(prompt) {
      queued.push(prompt)
    },
  })

  input.write('first prompt\n')
  await waitFor(() => prompts.includes('first prompt'))
  input.write('second prompt\n')
  await waitFor(() => queued.includes('second prompt'))
  await waitFor(() => outputChunks.join('').includes('dclaw[busy]>'))
  assert.deepEqual(prompts, ['first prompt'])

  releaseFirstPrompt?.()
  await waitFor(() => prompts.includes('second prompt'))
  input.write('/exit\n')
  input.end()

  await loop
  assert.deepEqual(prompts, ['first prompt', 'second prompt'])
})

test('runInteractiveReplLoop redraws the busy input prompt above active output', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const outputChunks = collectStreamOutput(output)
  const prompts: string[] = []
  let releasePrompt: (() => void) | undefined

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    input,
    output,
    onPrompt: async (prompt, control) => {
      prompts.push(prompt)
      control.writeOutput('assistant line\n')
      await new Promise<void>(resolve => {
        releasePrompt = resolve
      })
    },
  })

  input.write('first prompt\n')
  await waitFor(() => prompts.includes('first prompt'))
  await waitFor(() => outputChunks.join('').includes('assistant line\n'))
  await waitFor(() => outputChunks.join('').includes('dclaw[busy]>'))

  releasePrompt?.()
  input.write('/exit\n')
  input.end()

  await loop
  assert.match(outputChunks.join(''), /assistant line/)
  assert.match(outputChunks.join(''), /dclaw\[busy\]>/)
})

test('runInteractiveReplLoop runs allowed busy commands immediately', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const prompts: string[] = []
  const busyCommands: string[] = []
  let releaseFirstPrompt: (() => void) | undefined

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    input,
    output,
    onPrompt: async prompt => {
      prompts.push(prompt)
      if (prompt === 'first prompt') {
        await new Promise<void>(resolve => {
          releaseFirstPrompt = resolve
        })
      }
    },
    onBusyPrompt(prompt) {
      if (prompt === '/info') {
        busyCommands.push(prompt)
        return true
      }
      return false
    },
  })

  input.write('first prompt\n')
  await waitFor(() => prompts.includes('first prompt'))
  input.write('/info\n')
  await waitFor(() => busyCommands.includes('/info'))
  assert.deepEqual(prompts, ['first prompt'])

  releaseFirstPrompt?.()
  input.write('/exit\n')
  input.end()

  await loop
  assert.deepEqual(busyCommands, ['/info'])
})

test('runInteractiveReplLoop treats /abort as an interrupt command while busy', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const outputChunks = collectStreamOutput(output)
  const prompts: string[] = []

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    input,
    output,
    onPrompt: async (_prompt, control) => {
      prompts.push(_prompt)
      await new Promise<void>((resolve, reject) => {
        control.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })),
          { once: true },
        )
      })
    },
  })

  input.write('first prompt\n')
  await waitFor(() => prompts.includes('first prompt'))
  input.write('/abort\n')
  await waitFor(() =>
    outputChunks.join('').includes('Interrupted current response.'),
  )
  input.write('/exit\n')
  input.end()

  await loop
  assert.match(outputChunks.join(''), /Interrupted current response\./)
})

test('runInteractiveReplLoop handles immediate local commands without entering busy state', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const outputChunks = collectStreamOutput(output)
  const prompts: string[] = []
  const immediatePrompts: string[] = []

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    input,
    output,
    onImmediatePrompt(prompt, control) {
      if (prompt === '/runtime') {
        immediatePrompts.push(prompt)
        control.writeOutput('current runtime:\n')
        return true
      }
      return false
    },
    onPrompt: async prompt => {
      prompts.push(prompt)
    },
  })

  input.write('/runtime\n')
  await waitFor(() => immediatePrompts.includes('/runtime'))
  input.write('/exit\n')
  input.end()

  await loop
  const text = outputChunks.join('')
  assert.deepEqual(prompts, [])
  assert.deepEqual(immediatePrompts, ['/runtime'])
  assert.match(text, /current runtime:/)
  assert.doesNotMatch(text, /dclaw\[busy\]>/)
})

test('runInteractiveReplLoop interrupts the active prompt', async () => {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  const output = new PassThrough() as PassThrough & { isTTY?: boolean }
  const prompts: string[] = []
  const interrupted: string[] = []

  input.isTTY = true
  output.isTTY = true

  const loop = runInteractiveReplLoop({
    input,
    output,
    onPrompt: async (prompt, control) => {
      prompts.push(prompt)
      await new Promise<void>((_resolve, reject) => {
        control.signal.addEventListener(
          'abort',
          () => {
            const error = new Error('Request aborted')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true },
        )
      })
    },
    onPromptInterrupted(prompt) {
      interrupted.push(prompt)
    },
  })

  input.write('long prompt\n')
  await waitFor(() => prompts.includes('long prompt'))
  input.write('/interrupt\n')
  await waitFor(() => interrupted.includes('long prompt'))
  input.write('/exit\n')
  input.end()

  await loop
  assert.deepEqual(interrupted, ['long prompt'])
})
