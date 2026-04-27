import assert from 'node:assert/strict'
import test from 'node:test'
import { listReplCommands } from '../../src/cli/replCommands.js'
import { getActivityGroupTitle } from '../../src/tui/presenters/activityPresenter.js'
import { presentReplCommandResult } from '../../src/tui/presenters/replCommandPresenter.js'

test('presentReplCommandResult renders /session output as a structured card', () => {
  const presentation = presentReplCommandResult(
    '/session',
    [
      'current session:',
      'session id: abc123',
      'mode: interactive',
      'provider: openai',
      '',
      'query trace: /tmp/query-trace.ndjson',
    ].join('\n'),
  )

  assert.deepEqual(
    presentation.events.map(event => event.type),
    ['command_logged', 'structured_card_added'],
  )
  const cardEvent = presentation.events[1]
  assert.ok(cardEvent)
  assert.equal(cardEvent.type, 'structured_card_added')
  assert.equal(cardEvent.title, 'Current Session')
  assert.deepEqual(cardEvent.entries, [
    { kind: 'row', label: 'session id', value: 'abc123' },
    { kind: 'row', label: 'mode', value: 'interactive' },
    { kind: 'row', label: 'provider', value: 'openai' },
    { kind: 'separator' },
    { kind: 'row', label: 'query trace', value: '/tmp/query-trace.ndjson' },
  ])
})

test('presentReplCommandResult renders /help output as a structured card', () => {
  const presentation = presentReplCommandResult(
    '/help',
    [
      'REPL commands:',
      '/help  Show available REPL commands.',
      '/session (/info)  Show current session info.',
    ].join('\n'),
  )

  assert.deepEqual(
    presentation.events.map(event => event.type),
    ['command_logged', 'structured_card_added'],
  )
  const cardEvent = presentation.events[1]
  assert.ok(cardEvent)
  assert.equal(cardEvent.type, 'structured_card_added')
  assert.equal(cardEvent.title, 'REPL Commands')
  assert.deepEqual(cardEvent.entries, [
    { kind: 'text', text: '/help  Show available REPL commands.' },
    { kind: 'text', text: '/session (/info)  Show current session info.' },
  ])
})

test('info-style REPL commands are cataloged for structured card presentation', () => {
  const commandPresentation = new Map(
    listReplCommands().map(command => [
      command.name,
      {
        kind: command.presentationKind,
        title: command.presentationTitle,
      },
    ]),
  )

  assert.deepEqual(commandPresentation.get('/help'), {
    kind: 'structured_card',
    title: 'REPL Commands',
  })
  assert.deepEqual(commandPresentation.get('/plan'), {
    kind: 'structured_card',
    title: 'Plan Mode',
  })
  assert.deepEqual(commandPresentation.get('/session'), {
    kind: 'structured_card',
    title: 'Current Session',
  })
  assert.deepEqual(commandPresentation.get('/history'), {
    kind: 'structured_card',
    title: 'Session History',
  })
  assert.deepEqual(commandPresentation.get('/doctor'), {
    kind: 'structured_card',
    title: 'Diagnostics',
  })
  assert.deepEqual(commandPresentation.get('/runtime'), {
    kind: 'structured_card',
    title: 'Runtime',
  })
  assert.deepEqual(commandPresentation.get('/permissions'), {
    kind: 'structured_card',
    title: 'Permissions',
  })
  assert.deepEqual(commandPresentation.get('/config'), {
    kind: 'structured_card',
    title: 'DCLAW Config',
  })
  assert.deepEqual(commandPresentation.get('/transcript'), {
    kind: 'structured_card',
    title: 'Transcript',
  })
  assert.deepEqual(commandPresentation.get('/resume'), {
    kind: 'structured_card',
    title: 'Resume Session',
  })
  assert.deepEqual(commandPresentation.get('/compact'), {
    kind: 'structured_card',
    title: 'Compact Session',
  })
  assert.deepEqual(commandPresentation.get('/clear'), {
    kind: 'structured_card',
    title: 'Session Reset',
  })
})

test('getActivityGroupTitle maps core tool categories to transcript groups', () => {
  assert.equal(getActivityGroupTitle('Read'), 'Explored')
  assert.equal(getActivityGroupTitle('Bash'), 'Ran')
  assert.equal(getActivityGroupTitle('StructuredPatch'), 'Edited')
  assert.equal(getActivityGroupTitle('Agent'), 'Delegated')
  assert.equal(getActivityGroupTitle('TaskBoardUpdate'), 'Planned')
  assert.equal(getActivityGroupTitle('UnknownTool'), 'Activity')
})
