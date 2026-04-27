import assert from 'node:assert/strict'
import test from 'node:test'
import { CliArgumentError, parseArgs } from '../../src/cli/parseArgs.js'

test('parseArgs accepts an explicit runtime override', () => {
  const command = parseArgs([
    '--runtime',
    'anthropic-default',
    'exec',
    'hello',
  ])

  assert.equal(command.mode, 'exec')
  assert.equal(command.options.runtime, 'anthropic-default')
})

test('parseArgs accepts runtime + streaming flags together', () => {
  const command = parseArgs([
    '--runtime',
    'openai-fast',
    '--stream',
    'exec',
    'hello',
  ])

  assert.equal(command.mode, 'exec')
  assert.equal(command.options.runtime, 'openai-fast')
  assert.equal(command.options.stream, true)
})

test('parseArgs rejects removed --model overrides', () => {
  assert.throws(
    () => parseArgs(['--runtime', 'openai-fast', '--model', 'gpt-5']),
    /Unknown option: --model/,
  )
})

test('parseArgs enables streaming by default', () => {
  const command = parseArgs(['exec', 'hello'])

  assert.equal(command.mode, 'exec')
  assert.equal(command.options.stream, true)
})

test('parseArgs accepts explicit no-stream overrides', () => {
  const command = parseArgs(['exec', '--no-stream', 'hello'])

  assert.equal(command.mode, 'exec')
  assert.equal(command.options.stream, false)
})

test('parseArgs leaves permission mode unset when not explicitly provided', () => {
  const command = parseArgs(['exec', 'hello'])

  assert.equal(command.mode, 'exec')
  assert.equal(command.options.permissionMode, undefined)
})

test('parseArgs accepts explicit permission mode overrides', () => {
  const command = parseArgs([
    'exec',
    '--permission-mode',
    'accept-edits',
    'hello',
  ])

  assert.equal(command.mode, 'exec')
  assert.equal(command.options.permissionMode, 'accept-edits')
})

test('parseArgs rejects plan as a user permission mode override', () => {
  assert.throws(
    () => parseArgs(['exec', '--permission-mode', 'plan', 'hello']),
    /Unsupported permission mode: plan/,
  )
})

test('parseArgs accepts explicit max iteration overrides', () => {
  const command = parseArgs([
    'exec',
    '--max-iterations',
    '12',
    'hello',
  ])

  assert.equal(command.mode, 'exec')
  assert.equal(command.options.maxIterations, 12)
})

test('parseArgs rejects invalid max iteration overrides', () => {
  assert.throws(
    () => parseArgs(['--max-iterations', '0']),
    /--max-iterations must be a positive integer/,
  )
})

test('parseArgs requires a value for --runtime', () => {
  assert.throws(() => parseArgs(['--runtime']), /Missing value for --runtime/)
})

test('parseArgs rejects removed --output-format overrides', () => {
  assert.throws(
    () => parseArgs(['--output-format', 'json']),
    /Unknown option: --output-format/,
  )
})

test('parseArgs rejects removed --verbose overrides', () => {
  assert.throws(
    () => parseArgs(['exec', '--verbose', 'hello']),
    /Unknown option: --verbose/,
  )
})

test('parseArgs rejects the removed top-level resume command', () => {
  assert.throws(
    () => parseArgs(['resume', 'session-123']),
    /Unknown command: resume/,
  )
})

test('parseArgs rejects the removed top-level history command', () => {
  assert.throws(
    () => parseArgs(['history']),
    /Unknown command: history/,
  )
})

test('parseArgs accepts doctor as a top-level command', () => {
  const command = parseArgs(['doctor'])

  assert.equal(command.mode, 'doctor')
})

test('parseArgs rejects the removed --doctor flag', () => {
  assert.throws(
    () => parseArgs(['--doctor']),
    /Unknown option: --doctor/,
  )
})

test('parseArgs rejects the removed --print flag', () => {
  assert.throws(
    () => parseArgs(['--print', 'hello']),
    /Unknown option: --print/,
  )
})

test('parseArgs rejects prompt text for doctor mode', () => {
  assert.throws(
    () => parseArgs(['doctor', 'extra']),
    /doctor does not accept a prompt/,
  )
})

test('parseArgs rejects combining doctor with exec', () => {
  assert.throws(
    () => parseArgs(['doctor', 'exec']),
    /exec cannot be combined with doctor/,
  )
})

test('parseArgs accepts the experimental TUI flag', () => {
  const command = parseArgs(['--tui', 'hello'])

  assert.equal(command.mode, 'interactive')
  assert.equal(command.options.interactiveUi, 'tui')
})

test('parseArgs accepts the legacy REPL flag', () => {
  const command = parseArgs(['--legacy-repl', 'hello'])

  assert.equal(command.mode, 'interactive')
  assert.equal(command.options.interactiveUi, 'legacy-repl')
})

test('parseArgs rejects conflicting interactive UI flags', () => {
  assert.throws(
    () => parseArgs(['--tui', '--legacy-repl', 'hello']),
    /cannot be combined/,
  )
})
