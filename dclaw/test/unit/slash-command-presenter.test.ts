import assert from 'node:assert/strict'
import test from 'node:test'
import { listSlashCommands } from '../../src/cli/slashCommands.js'
import { getActivityGroupTitle } from '../../src/tui/presenters/activityPresenter.js'
import {
  COMPACT_COMMAND_PROGRESS_TEXT,
  presentSlashCommandResult,
  presentSlashCommandStart,
} from '../../src/tui/presenters/slashCommandPresenter.js'

test('presentSlashCommandResult renders /status output as a structured card', () => {
  const presentation = presentSlashCommandResult(
    '/status',
    [
      'status:',
      'session id: abc123',
      'mode: interactive',
      'runtime: review',
      'runtime source: workspace_config',
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
  assert.equal(cardEvent.title, 'Status')
  assert.deepEqual(cardEvent.entries, [
    { kind: 'row', label: 'session id', value: 'abc123' },
    { kind: 'row', label: 'mode', value: 'interactive' },
    { kind: 'row', label: 'runtime', value: 'review' },
    { kind: 'row', label: 'runtime source', value: 'workspace_config' },
    { kind: 'row', label: 'provider', value: 'openai' },
    { kind: 'separator' },
    { kind: 'row', label: 'query trace', value: '/tmp/query-trace.ndjson' },
  ])
})

test('presentSlashCommandResult renders /resume output as transcript prose', () => {
  const presentation = presentSlashCommandResult(
    '/resume session-123',
    [
      'Resumed session: session-123',
      'restored runtime: historic-runtime',
      'restored provider/model: stub / restored-model',
      '',
      'restored transcript preview:',
      'user: restored user',
      '',
      'assistant: restored assistant',
    ].join('\n'),
  )

  assert.deepEqual(
    presentation.events.map(event => event.type),
    ['command_logged', 'assistant_progress_message'],
  )
  const noteEvent = presentation.events[1]
  assert.ok(noteEvent)
  assert.equal(noteEvent.type, 'assistant_progress_message')
  assert.match(noteEvent.text, /restored transcript preview:/)
  assert.match(noteEvent.text, /assistant: restored assistant/)
})

test('presentSlashCommandStart renders immediate /compact progress', () => {
  const presentation = presentSlashCommandStart('/compact keep key details')

  assert.deepEqual(
    presentation.events.map(event => event.type),
    ['command_logged', 'tool_use_started'],
  )
  const activityEvent = presentation.events[1]
  assert.ok(activityEvent)
  assert.equal(activityEvent.type, 'tool_use_started')
  assert.equal(activityEvent.title, 'Session')
  assert.equal(activityEvent.toolName, 'Compact')
  assert.equal(activityEvent.text, COMPACT_COMMAND_PROGRESS_TEXT)
})

test('presentSlashCommandResult can skip command logging after start progress', () => {
  const presentation = presentSlashCommandResult(
    '/compact',
    [
      'Compacted conversation into a summary within the current session.',
      'session id: abc123',
    ].join('\n'),
    { includeCommandLog: false },
  )

  assert.deepEqual(
    presentation.events.map(event => event.type),
    ['structured_card_added'],
  )
})

test('presentSlashCommandResult keeps long structured card rows on one line', () => {
  const longSessionId = '86509d3c-082f-4f34-a70a-0118b5e76194'
  const presentation = presentSlashCommandResult(
    '/status',
    [
      'status:',
      `session id: ${longSessionId}`,
      'stored provider/model: openai / gpt-5.4',
    ].join('\n'),
  )
  const cardEvent = presentation.events[1]
  assert.ok(cardEvent)
  assert.equal(cardEvent.type, 'structured_card_added')
  assert.deepEqual(cardEvent.entries, [
    { kind: 'row', label: 'session id', value: longSessionId },
    {
      kind: 'row',
      label: 'stored provider/model',
      value: 'openai / gpt-5.4',
    },
  ])
})

test('status-style slash commands are cataloged for structured card presentation', () => {
  const commands = listSlashCommands()
  const commandPresentation = new Map(
    commands.map(command => [
      command.name,
      {
        kind: command.presentationKind,
        title: command.presentationTitle,
      },
    ]),
  )

  assert.deepEqual(commandPresentation.get('/status'), {
    kind: 'structured_card',
    title: 'Status',
  })
  assert.deepEqual(commandPresentation.get('/runtime'), {
    kind: 'structured_card',
    title: 'Runtime',
  })
  assert.deepEqual(commandPresentation.get('/permissions'), {
    kind: 'structured_card',
    title: 'Permissions',
  })
  assert.deepEqual(commandPresentation.get('/skills'), {
    kind: 'structured_card',
    title: 'Skills',
  })
  assert.deepEqual(commandPresentation.get('/resume'), {
    kind: 'assistant_note',
    title: undefined,
  })
  assert.deepEqual(commandPresentation.get('/compact'), {
    kind: 'structured_card',
    title: 'Compact Session',
  })
  assert.deepEqual(commandPresentation.get('/clear'), {
    kind: 'structured_card',
    title: 'Session Reset',
  })
  assert.deepEqual(commandPresentation.get('/plan'), {
    kind: 'structured_card',
    title: 'Plan Mode',
  })
  assert.equal(commandPresentation.has('/help'), false)
  assert.equal(commandPresentation.has('/history'), false)
  assert.equal(commandPresentation.has('/doctor'), false)
  assert.equal(commandPresentation.has('/interrupt'), false)
  assert.equal(commandPresentation.has('/transcript'), false)
  assert.equal(commandPresentation.has('/config'), false)
  assert.equal(commandPresentation.has('/cls'), false)
  assert.equal(commandPresentation.has('/session'), false)
  assert.equal(
    commands.some(command => command.aliases?.includes('/info')),
    false,
  )
  assert.equal(
    commands.some(command => command.aliases?.includes('/cancel')),
    false,
  )
})

test('slash command catalog includes TUI metadata for slash controls', () => {
  const commands = listSlashCommands()
  const commandMetadata = new Map(
    commands.map(command => [
      command.name,
      {
        displayName: command.displayName,
        argKind: command.argKind,
        argumentHint: command.argumentHint,
      },
    ]),
  )

  assert.deepEqual(commandMetadata.get('/runtime'), {
    displayName: 'Runtime',
    argKind: 'enum',
    argumentHint: '[name|list]',
  })
  assert.deepEqual(commandMetadata.get('/permissions'), {
    displayName: 'Permissions',
    argKind: 'enum',
    argumentHint: '[mode]',
  })
  assert.deepEqual(commandMetadata.get('/compact'), {
    displayName: 'Compact',
    argKind: 'freeform',
    argumentHint: '[instructions]',
  })
  assert.deepEqual(commandMetadata.get('/skills'), {
    displayName: 'Skills',
    argKind: 'none',
    argumentHint: undefined,
  })
  assert.deepEqual(commandMetadata.get('/plan'), {
    displayName: 'Plan',
    argKind: 'enum',
    argumentHint: '[enter|exit|show]',
  })
  assert.equal(commandMetadata.has('/help'), false)
  assert.equal(commandMetadata.has('/history'), false)
  assert.equal(commandMetadata.has('/doctor'), false)
  assert.equal(commandMetadata.has('/interrupt'), false)
  assert.equal(commandMetadata.has('/transcript'), false)
  assert.equal(commandMetadata.has('/config'), false)
  assert.equal(commandMetadata.has('/cls'), false)
  assert.equal(commandMetadata.has('/cancel'), false)
  assert.equal(commandMetadata.has('/session'), false)
  assert.equal(commandMetadata.has('/info'), false)
  assert.deepEqual(commandMetadata.get('/status'), {
    displayName: 'Status',
    argKind: 'none',
    argumentHint: undefined,
  })
  assert.equal(
    commands.some(command => command.aliases?.includes('/info')),
    false,
  )
  assert.equal(
    commands.some(command => command.aliases?.includes('/cancel')),
    false,
  )
})

test('getActivityGroupTitle maps core tool categories to transcript groups', () => {
  assert.equal(getActivityGroupTitle('Read'), 'Explored')
  assert.equal(getActivityGroupTitle('Bash'), 'Ran')
  assert.equal(getActivityGroupTitle('Bash', { command: 'ls src' }), 'Explored')
  assert.equal(getActivityGroupTitle('AskUserQuestion'), 'Questions')
  assert.equal(getActivityGroupTitle('StructuredPatch'), 'Edited')
  assert.equal(getActivityGroupTitle('Agent'), 'Delegated')
  assert.equal(getActivityGroupTitle('TaskBoardUpdate'), 'Planned')
  assert.equal(getActivityGroupTitle('UnknownTool'), 'Activity')
})
