import assert from 'node:assert/strict'
import test from 'node:test'
import { CliArgumentError, parseArgs } from '../../src/cli/parseArgs.js'

test('parseArgs accepts anthropic as a provider', () => {
  const command = parseArgs([
    '--provider',
    'anthropic',
    '--model',
    'claude-test',
    '--print',
    'hello',
  ])

  assert.equal(command.mode, 'print')
  assert.equal(command.options.provider, 'anthropic')
  assert.equal(command.options.model, 'claude-test')
})

test('parseArgs accepts openai as a provider', () => {
  const command = parseArgs([
    '--provider',
    'openai',
    '--model',
    'gpt-5',
    '--stream',
    '--output-format',
    'sse',
    '--print',
    'hello',
  ])

  assert.equal(command.mode, 'print')
  assert.equal(command.options.provider, 'openai')
  assert.equal(command.options.model, 'gpt-5')
  assert.equal(command.options.stream, true)
  assert.equal(command.options.outputFormat, 'sse')
})

test('parseArgs reports supported providers for invalid input', () => {
  assert.throws(
    () => parseArgs(['--provider', 'unknown']),
    (error: unknown) => {
      assert(error instanceof CliArgumentError)
      assert.match(
        error.message,
        /Supported providers: stub, anthropic, openai/,
      )
      return true
    },
  )
})

test('parseArgs rejects unsupported output format', () => {
  assert.throws(
    () => parseArgs(['--output-format', 'json']),
    /Supported formats: text, sse/,
  )
})
