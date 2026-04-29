import {
  listSlashCommands,
  type SlashCommandCatalogItem,
} from '../../cli/slashCommands.js'
import type { StructuredCardEntry, UiEvent } from '../state/types.js'

type SlashCommandPresentation = {
  events: UiEvent[]
}

type PresentSlashCommandResultOptions = {
  includeCommandLog?: boolean
}

const COMPACT_COMMAND_ACTIVITY_ID = 'local-command-compact-context'
export const COMPACT_COMMAND_PROGRESS_TEXT =
  'Compacting conversation context...'
export const COMPACT_COMMAND_DONE_TEXT = 'Compact command finished.'
export const COMPACT_COMMAND_FAILED_TEXT = 'Context compaction failed.'

function normalizeCommandName(value: string): string {
  return value.trim().split(/\s+/u)[0]?.toLowerCase() ?? ''
}

function findSlashCommandMetadata(
  prompt: string,
): SlashCommandCatalogItem | undefined {
  const commandName = normalizeCommandName(prompt)
  return listSlashCommands().find(
    command =>
      command.name.toLowerCase() === commandName ||
      command.aliases?.some(alias => alias.toLowerCase() === commandName),
  )
}

function tryParseStructuredRow(
  line: string,
): { label: string; value: string } | undefined {
  const colonMatch = line.match(/^([^:]+):\s*(.*)$/u)
  if (colonMatch) {
    const label = colonMatch[1]?.trim()
    const value = colonMatch[2]?.trim() ?? ''
    if (label) {
      return {
        label,
        value,
      }
    }
  }

  const paddedMatch = line.match(/^([A-Za-z][A-Za-z0-9 /_.()-]*?)\s{2,}(.*)$/u)
  if (!paddedMatch) {
    return undefined
  }

  const label = paddedMatch[1]?.trim()
  const value = paddedMatch[2]?.trim() ?? ''
  if (!label) {
    return undefined
  }

  return {
    label,
    value,
  }
}

function buildStructuredCardEntries(
  lines: string[],
  title: string,
): StructuredCardEntry[] {
  const normalizedTitle = title.replace(/:$/u, '').trim().toLowerCase()
  const entries: StructuredCardEntry[] = []

  for (const rawLine of lines) {
    const trimmedRightLine = rawLine.trimEnd()
    const normalizedLine = trimmedRightLine.replace(/:$/u, '').trim().toLowerCase()
    if (normalizedLine.length === 0) {
      if (entries.length > 0 && entries.at(-1)?.kind !== 'separator') {
        entries.push({ kind: 'separator' })
      }
      continue
    }

    if (normalizedLine === normalizedTitle) {
      continue
    }

    const row = tryParseStructuredRow(trimmedRightLine.trim())
    if (row) {
      entries.push({
        kind: 'row',
        label: row.label,
        value: row.value,
      })
      continue
    }

    entries.push({
      kind: 'text',
      text: trimmedRightLine.trim(),
    })
  }

  return entries
}

export function presentSlashCommandStart(
  prompt: string,
): SlashCommandPresentation {
  const metadata = findSlashCommandMetadata(prompt)
  if (metadata?.name !== '/compact') {
    return { events: [] }
  }

  return {
    events: [
      {
        type: 'command_logged',
        prompt,
      },
      {
        type: 'tool_use_started',
        toolUseId: COMPACT_COMMAND_ACTIVITY_ID,
        title: 'Session',
        toolName: 'Compact',
        text: COMPACT_COMMAND_PROGRESS_TEXT,
      },
    ],
  }
}

export function presentSlashCommandResult(
  prompt: string,
  outputText: string,
  options: PresentSlashCommandResultOptions = {},
): SlashCommandPresentation {
  const metadata = findSlashCommandMetadata(prompt)
  const includeCommandLog = options.includeCommandLog ?? true
  const events: UiEvent[] = includeCommandLog
    ? [
        {
          type: 'command_logged',
          prompt,
        },
      ]
    : []
  const normalizedOutputText = outputText.trim()
  if (normalizedOutputText.length === 0) {
    return { events }
  }

  if (metadata?.presentationKind === 'structured_card') {
    const title = metadata.presentationTitle ?? metadata.name
    events.push({
      type: 'structured_card_added',
      title,
      entries: buildStructuredCardEntries(
        normalizedOutputText.split('\n'),
        title,
      ),
    })
    return { events }
  }

  events.push({
    type: 'assistant_progress_message',
    text: normalizedOutputText,
  })
  return { events }
}
