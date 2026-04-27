import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatActiveTurnStatusText,
  formatCompletedTurnStatusText,
  formatElapsedDuration,
} from '../../src/tui/presenters/turnStatusPresenter.js'

test('formatElapsedDuration renders seconds and minute-second durations', () => {
  assert.equal(formatElapsedDuration(0), '0s')
  assert.equal(formatElapsedDuration(12_345), '12s')
  assert.equal(formatElapsedDuration(95_000), '1m 35s')
})

test('turn status presenter formats active and completed labels', () => {
  assert.equal(
    formatActiveTurnStatusText(95_000),
    'Working (1m 35s, Esc to cancel)',
  )
  assert.equal(
    formatCompletedTurnStatusText(155_000),
    'Worked for 2m 35s',
  )
})
