import type { TranscriptItem } from '../state/index.js'

export function buildPhase0TranscriptEntries(options: {
  initialPrompt?: string
  sessionId: string
  permissionModeSource: string
}): TranscriptItem[] {
  const entries: TranscriptItem[] = [
    {
      id: 'phase0-system-1',
      kind: 'system',
      text:
        'DCLAW TUI skeleton is ready. Phase 1 will connect the live transcript reducer and interactive turn presenter.',
    },
    {
      id: 'phase0-system-2',
      kind: 'system',
      text: `Session: ${options.sessionId} · permission source: ${options.permissionModeSource}`,
    },
  ]

  if (options.initialPrompt) {
    entries.unshift({
      id: 'phase0-user-1',
      kind: 'user_prompt',
      text: options.initialPrompt,
    })
  }

  return entries
}
