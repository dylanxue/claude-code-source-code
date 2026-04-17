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

test('parseArgs enables verbose mode', () => {
  const command = parseArgs(['--print', '--verbose', 'hello'])

  assert.equal(command.mode, 'print')
  assert.equal(command.options.verbose, true)
})

test('parseArgs leaves permission mode unset when not explicitly provided', () => {
  const command = parseArgs(['--print', 'hello'])

  assert.equal(command.mode, 'print')
  assert.equal(command.options.permissionMode, undefined)
})

test('parseArgs accepts explicit permission mode overrides', () => {
  const command = parseArgs([
    '--print',
    '--permission-mode',
    'plan',
    'hello',
  ])

  assert.equal(command.mode, 'print')
  assert.equal(command.options.permissionMode, 'plan')
})

test('parseArgs accepts explicit max iteration overrides', () => {
  const command = parseArgs([
    '--print',
    '--max-iterations',
    '12',
    'hello',
  ])

  assert.equal(command.mode, 'print')
  assert.equal(command.options.maxIterations, 12)
})

test('parseArgs rejects invalid max iteration overrides', () => {
  assert.throws(
    () => parseArgs(['--max-iterations', '0']),
    /--max-iterations must be a positive integer/,
  )
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

test('parseArgs keeps prompt text for resume mode', () => {
  const command = parseArgs(['resume', 'session-123', 'continue', 'here'])

  assert.equal(command.mode, 'resume')
  assert.equal(command.sessionId, 'session-123')
  assert.equal(command.prompt, 'continue here')
})

test('parseArgs supports history mode', () => {
  const command = parseArgs(['history'])

  assert.equal(command.mode, 'history')
})

test('parseArgs rejects prompt text for history mode', () => {
  assert.throws(
    () => parseArgs(['history', 'extra']),
    /history does not accept a prompt/,
  )
})
