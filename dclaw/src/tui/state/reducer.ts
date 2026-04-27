import type {
  ActivityEntry,
  StructuredCardEntry,
  TranscriptItem,
  UiEvent,
  UiState,
} from './types.js'
import { DEFAULT_COMPOSER_PLACEHOLDER } from './types.js'

function createTranscriptItemId(state: UiState): string {
  return `tx_${state.nextTranscriptItemId}`
}

function appendTranscriptItem(
  state: UiState,
  item:
    | Omit<Extract<TranscriptItem, { kind: 'system' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'user_prompt' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'user_command' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'assistant_note' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'assistant_draft' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'activity_group' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'structured_card' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'time_separator' }>, 'id'>,
): UiState {
  const id = createTranscriptItemId(state)
  return {
    ...state,
    nextTranscriptItemId: state.nextTranscriptItemId + 1,
    transcript: [
      ...state.transcript,
      {
        id,
        ...item,
      },
    ],
  }
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function updateTranscriptItem(
  transcript: TranscriptItem[],
  itemId: string,
  updater: (item: TranscriptItem) => TranscriptItem,
): TranscriptItem[] {
  return transcript.map(item => (item.id === itemId ? updater(item) : item))
}

function moveTranscriptItemToEnd(
  transcript: TranscriptItem[],
  itemId: string | undefined,
): TranscriptItem[] {
  if (!itemId) {
    return transcript
  }

  const item = transcript.find(entry => entry.id === itemId)
  if (!item || transcript.at(-1)?.id === itemId) {
    return transcript
  }

  return [...transcript.filter(entry => entry.id !== itemId), item]
}

function getLastTranscriptItem(
  transcript: TranscriptItem[],
): TranscriptItem | undefined {
  return transcript.at(-1)
}

function getRecentActivityGroupForTitle(
  transcript: TranscriptItem[],
  title: string,
  assistantDraftId: string | undefined,
): Extract<TranscriptItem, { kind: 'activity_group' }> | undefined {
  const lastItem = transcript.at(-1)
  if (lastItem?.kind === 'activity_group' && lastItem.title === title) {
    return lastItem
  }

  if (lastItem?.id === assistantDraftId) {
    const previousItem = transcript.at(-2)
    if (previousItem?.kind === 'activity_group' && previousItem.title === title) {
      return previousItem
    }
  }

  return undefined
}

function getCardEntriesForStructuredOutput(
  entries: StructuredCardEntry[],
): StructuredCardEntry[] {
  const nextEntries = [...entries]
  while (nextEntries[0]?.kind === 'separator') {
    nextEntries.shift()
  }
  while (nextEntries.at(-1)?.kind === 'separator') {
    nextEntries.pop()
  }
  return nextEntries
}

function getActivityEntriesForToolResult(
  entries: ActivityEntry[],
  toolUseId: string,
  text: string,
): ActivityEntry[] {
  let matched = false
  const nextEntries = entries.map(entry => {
    if (entry.toolUseId !== toolUseId) {
      return entry
    }

    matched = true
    return {
      ...entry,
      status: 'completed' as const,
      text,
    }
  })

  if (matched) {
    return nextEntries
  }

  return [
    ...nextEntries,
    {
      toolUseId,
      status: 'completed' as const,
      text,
    },
  ]
}

function finalizeAssistantDraft(state: UiState, outputText: string): UiState {
  const normalizedOutput = outputText.trimEnd()
  if (!state.activeTurn.assistantDraftId) {
    if (normalizedOutput.length === 0) {
      return state
    }

    const lastAssistantText = [...state.transcript]
      .reverse()
      .find(
        item =>
          item.kind === 'assistant_note' || item.kind === 'assistant_draft',
      )
    if (
      lastAssistantText &&
      normalizeInlineText(lastAssistantText.text) ===
        normalizeInlineText(normalizedOutput)
    ) {
      return state
    }

    return appendTranscriptItem(state, {
      kind: 'assistant_note',
      text: normalizedOutput,
    })
  }

  const updatedTranscript = updateTranscriptItem(
    state.transcript,
    state.activeTurn.assistantDraftId,
    item => {
      if (item.kind !== 'assistant_draft') {
        return item
      }

      const nextText =
        normalizedOutput.length > 0 ? normalizedOutput : item.text.trimEnd()

      return {
        id: item.id,
        kind: 'assistant_note',
        text: nextText,
      }
    },
  )

  return {
    ...state,
    transcript: updatedTranscript,
    activeTurn: {
      ...state.activeTurn,
      assistantDraftId: undefined,
    },
  }
}

function sealAssistantDraftInPlace(state: UiState): UiState {
  if (!state.activeTurn.assistantDraftId) {
    return state
  }

  const updatedTranscript = updateTranscriptItem(
    state.transcript,
    state.activeTurn.assistantDraftId,
    item => {
      if (item.kind !== 'assistant_draft') {
        return item
      }

      return {
        id: item.id,
        kind: 'assistant_note',
        text: item.text.trimEnd(),
      }
    },
  )

  return {
    ...state,
    transcript: updatedTranscript,
    activeTurn: {
      ...state.activeTurn,
      assistantDraftId: undefined,
    },
  }
}

export function createInitialUiState(): UiState {
  return {
    transcript: [],
    bottomDock: {
      mode: 'default',
      inputValue: '',
      placeholder: DEFAULT_COMPOSER_PLACEHOLDER,
    },
    overlay: {
      kind: 'none',
    },
    nextTranscriptItemId: 1,
    activeTurn: {},
  }
}

export function reduceUiEvent(state: UiState, event: UiEvent): UiState {
  switch (event.type) {
    case 'command_logged':
      if (normalizeInlineText(event.prompt).length === 0) {
        return state
      }

      return appendTranscriptItem(state, {
        kind: 'user_command',
        text: event.prompt,
      })

    case 'turn_started': {
      const nextState = appendTranscriptItem(state, {
        kind: event.promptKind === 'slash' ? 'user_command' : 'user_prompt',
        text: event.prompt,
      })

      return {
        ...nextState,
        activeTurn: {
          prompt: event.prompt,
          promptKind: event.promptKind,
        },
      }
    }

    case 'assistant_text_delta': {
      if (event.text.length === 0) {
        return state
      }

      if (state.activeTurn.assistantDraftId) {
        const updatedTranscript = updateTranscriptItem(
          state.transcript,
          state.activeTurn.assistantDraftId,
          item => {
            if (item.kind !== 'assistant_draft') {
              return item
            }

            return {
              ...item,
              text: item.text + event.text,
            }
          },
        )

        return {
          ...state,
          transcript: updatedTranscript,
        }
      }

      const nextState = appendTranscriptItem(state, {
        kind: 'assistant_draft',
        text: event.text,
      })

      const assistantDraft = nextState.transcript.at(-1)
      return {
        ...nextState,
        activeTurn: {
          ...nextState.activeTurn,
          assistantDraftId: assistantDraft?.id,
        },
      }
    }

    case 'assistant_progress_message': {
      if (normalizeInlineText(event.text).length === 0) {
        return state
      }

      return appendTranscriptItem(state, {
        kind: 'assistant_note',
        text: event.text,
      })
    }

    case 'tool_use_started': {
      const stateBeforeToolUse = sealAssistantDraftInPlace(state)
      const title = event.title ?? 'Activity'
      const recentActivityGroup = getRecentActivityGroupForTitle(
        stateBeforeToolUse.transcript,
        title,
        stateBeforeToolUse.activeTurn.assistantDraftId,
      )

      if (recentActivityGroup) {
        const updatedTranscript = updateTranscriptItem(
          stateBeforeToolUse.transcript,
          recentActivityGroup.id,
          item => {
            if (item.kind !== 'activity_group') {
              return item
            }

            return {
              ...item,
              entries: [
                ...item.entries,
                {
                  toolUseId: event.toolUseId,
                  status: 'started',
                  text: event.text,
                },
              ],
            }
          },
        )

        return {
          ...stateBeforeToolUse,
          transcript: updatedTranscript,
          activeTurn: {
            ...stateBeforeToolUse.activeTurn,
            activityToolGroupIds: {
              ...(stateBeforeToolUse.activeTurn.activityToolGroupIds ?? {}),
              [event.toolUseId]: recentActivityGroup.id,
            },
          },
        }
      }

      const nextState = appendTranscriptItem(stateBeforeToolUse, {
        kind: 'activity_group',
        title,
        entries: [
          {
            toolUseId: event.toolUseId,
            status: 'started',
            text: event.text,
          },
        ],
      })
      const activityGroup = getLastTranscriptItem(nextState.transcript)

      return {
        ...nextState,
        activeTurn: {
          ...nextState.activeTurn,
          activityToolGroupIds: {
            ...(nextState.activeTurn.activityToolGroupIds ?? {}),
            ...(activityGroup?.id
              ? { [event.toolUseId]: activityGroup.id }
              : {}),
          },
        },
      }
    }

    case 'tool_result_received': {
      const activityGroupId =
        state.activeTurn.activityToolGroupIds?.[event.toolUseId]

      if (!activityGroupId) {
        const nextState = appendTranscriptItem(state, {
          kind: 'activity_group',
          title: 'Activity',
          entries: [
            {
              toolUseId: event.toolUseId,
              status: 'completed',
              text: event.text,
            },
          ],
        })

        return {
          ...nextState,
        }
      }

      const updatedTranscript = updateTranscriptItem(
        state.transcript,
        activityGroupId,
        item => {
          if (item.kind !== 'activity_group') {
            return item
          }

          return {
            ...item,
            entries: getActivityEntriesForToolResult(
              item.entries,
              event.toolUseId,
              event.text,
            ),
          }
        },
      )

      return {
        ...state,
        transcript: updatedTranscript,
      }
    }

    case 'system_notice':
      if (normalizeInlineText(event.text).length === 0) {
        return state
      }

      return appendTranscriptItem(state, {
        kind: 'system',
        text: event.text,
      })

    case 'structured_card_added':
      return appendTranscriptItem(state, {
        kind: 'structured_card',
        title: event.title,
        entries: getCardEntriesForStructuredOutput(event.entries),
      })

    case 'turn_completed': {
      const nextState = finalizeAssistantDraft(state, event.outputText)
      return {
        ...nextState,
        activeTurn: {},
      }
    }

    case 'turn_interrupted':
      return appendTranscriptItem(
        {
          ...state,
          activeTurn: {},
        },
        {
          kind: 'system',
          text: `Interrupted: ${event.prompt}`,
        },
      )

    case 'transcript_cleared':
      return {
        ...state,
        transcript: [],
        nextTranscriptItemId: 1,
        activeTurn: {},
      }

    case 'time_separator_added':
      if (normalizeInlineText(event.text).length === 0) {
        return state
      }

      return appendTranscriptItem(state, {
        kind: 'time_separator',
        text: event.text,
      })
  }
}
