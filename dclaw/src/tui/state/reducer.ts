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
    | Omit<Extract<TranscriptItem, { kind: 'assistant_stream_chunk' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'assistant_draft' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'activity_group' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'structured_card' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'task_list_snapshot' }>, 'id'>
    | Omit<Extract<TranscriptItem, { kind: 'plan_mode_snapshot' }>, 'id'>
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

function getTaskSnapshotSignature(
  snapshot: Extract<TranscriptItem, { kind: 'task_list_snapshot' }>['snapshot'],
): string {
  return JSON.stringify({
    boardId: snapshot.boardId,
    executionState: snapshot.executionState,
    currentTaskId: snapshot.currentTaskId,
    completedCount: snapshot.completedCount,
    totalCount: snapshot.totalCount,
    tasks: snapshot.tasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      blockedBy: task.blockedBy,
      isCurrent: task.isCurrent,
    })),
  })
}

function getLastTaskSnapshotForBoard(
  transcript: TranscriptItem[],
  boardId: string,
): Extract<TranscriptItem, { kind: 'task_list_snapshot' }> | undefined {
  return [...transcript]
    .reverse()
    .find(
      (item): item is Extract<TranscriptItem, { kind: 'task_list_snapshot' }> =>
        item.kind === 'task_list_snapshot' && item.snapshot.boardId === boardId,
    )
}

function getPlanSnapshotSignature(
  snapshot: Extract<TranscriptItem, { kind: 'plan_mode_snapshot' }>['snapshot'],
): string {
  return JSON.stringify({
    sessionId: snapshot.sessionId,
    status: snapshot.status,
    planFilePath: snapshot.planFilePath,
    resumePermissionMode: snapshot.resumePermissionMode,
  })
}

function getLastPlanSnapshotForSession(
  transcript: TranscriptItem[],
  sessionId: string,
): Extract<TranscriptItem, { kind: 'plan_mode_snapshot' }> | undefined {
  return [...transcript]
    .reverse()
    .find(
      (item): item is Extract<TranscriptItem, { kind: 'plan_mode_snapshot' }> =>
        item.kind === 'plan_mode_snapshot' &&
        item.snapshot.sessionId === sessionId,
    )
}

function getActivityEntriesForToolResult(
  entries: ActivityEntry[],
  toolUseId: string,
  text: string,
  output?: unknown,
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
      output,
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
      output,
    },
  ]
}

function sealTrailingAssistantStreamChunks(
  state: UiState,
  replacementText?: string,
): UiState {
  let startIndex = state.transcript.length
  while (
    startIndex > 0 &&
    state.transcript[startIndex - 1]?.kind === 'assistant_stream_chunk'
  ) {
    startIndex -= 1
  }

  if (startIndex === state.transcript.length) {
    return state
  }

  const trailingChunks = state.transcript.slice(startIndex)
  const fallbackText = trailingChunks
    .map(item =>
      item.kind === 'assistant_stream_chunk' ? item.text : '',
    )
    .join('')
    .trimEnd()
  const nextText = replacementText?.trimEnd() ?? fallbackText
  const firstChunk = trailingChunks[0]
  const nextTranscript = state.transcript.slice(0, startIndex)

  if (nextText.length > 0 && firstChunk) {
    nextTranscript.push({
      id: firstChunk.id,
      kind: 'assistant_note',
      text: nextText,
    })
  }

  return {
    ...state,
    transcript: nextTranscript,
    activeTurn: {
      ...state.activeTurn,
      streamedAssistantText: undefined,
    },
  }
}

function finalizeAssistantDraft(state: UiState, outputText: string): UiState {
  const normalizedOutput = outputText.trimEnd()
  if (!state.activeTurn.assistantDraftId) {
    const stateAfterSealedStreamChunks = sealTrailingAssistantStreamChunks(
      state,
      normalizedOutput.length > 0 ? normalizedOutput : undefined,
    )
    if (stateAfterSealedStreamChunks !== state) {
      return stateAfterSealedStreamChunks
    }

    if (normalizedOutput.length === 0) {
      return state
    }

    const streamedText = state.activeTurn.streamedAssistantText?.trimEnd()
    if (
      streamedText &&
      normalizeInlineText(streamedText) === normalizeInlineText(normalizedOutput)
    ) {
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

      return appendTranscriptItem(sealTrailingAssistantStreamChunks(state), {
        kind: 'user_command',
        text: event.prompt,
      })

    case 'turn_started': {
      const nextState = appendTranscriptItem(
        sealTrailingAssistantStreamChunks(state),
        {
          kind: event.promptKind === 'slash' ? 'user_command' : 'user_prompt',
          text: event.prompt,
        },
      )

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

    case 'assistant_stream_chunk': {
      if (event.text.length === 0) {
        return state
      }

      const nextState = appendTranscriptItem(state, {
        kind: 'assistant_stream_chunk',
        text: event.text,
      })

      return {
        ...nextState,
        activeTurn: {
          ...nextState.activeTurn,
          streamedAssistantText:
            (nextState.activeTurn.streamedAssistantText ?? '') + event.text,
        },
      }
    }

    case 'assistant_progress_message': {
      if (normalizeInlineText(event.text).length === 0) {
        return state
      }

      return appendTranscriptItem(sealTrailingAssistantStreamChunks(state), {
        kind: 'assistant_note',
        text: event.text,
      })
    }

    case 'tool_use_started': {
      const stateBeforeToolUse = sealTrailingAssistantStreamChunks(
        sealAssistantDraftInPlace(state),
      )
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
                  toolName: event.toolName,
                  input: event.input,
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
            toolName: event.toolName,
            input: event.input,
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
      const stateBeforeToolResult = sealTrailingAssistantStreamChunks(state)
      const activityGroupId =
        stateBeforeToolResult.activeTurn.activityToolGroupIds?.[event.toolUseId]

      if (!activityGroupId) {
        const nextState = appendTranscriptItem(stateBeforeToolResult, {
          kind: 'activity_group',
          title: 'Activity',
          entries: [
            {
              toolUseId: event.toolUseId,
              status: 'completed',
              text: event.text,
              output: event.output,
            },
          ],
        })

        return {
          ...nextState,
        }
      }

      const updatedTranscript = updateTranscriptItem(
        stateBeforeToolResult.transcript,
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
              event.output,
            ),
          }
        },
      )

      return {
        ...stateBeforeToolResult,
        transcript: updatedTranscript,
      }
    }

    case 'system_notice':
      if (normalizeInlineText(event.text).length === 0) {
        return state
      }

      return appendTranscriptItem(sealTrailingAssistantStreamChunks(state), {
        kind: 'system',
        text: event.text,
      })

    case 'structured_card_added':
      return appendTranscriptItem(sealTrailingAssistantStreamChunks(state), {
        kind: 'structured_card',
        title: event.title,
        entries: getCardEntriesForStructuredOutput(event.entries),
      })

    case 'task_board_updated': {
      const stateBeforeSnapshot = sealTrailingAssistantStreamChunks(
        sealAssistantDraftInPlace(state),
      )
      const lastSnapshot = getLastTaskSnapshotForBoard(
        stateBeforeSnapshot.transcript,
        event.snapshot.boardId,
      )
      if (
        lastSnapshot &&
        getTaskSnapshotSignature(lastSnapshot.snapshot) ===
          getTaskSnapshotSignature(event.snapshot)
      ) {
        return stateBeforeSnapshot
      }

      return appendTranscriptItem(
        {
          ...stateBeforeSnapshot,
          transcript: stateBeforeSnapshot.transcript,
        },
        {
          kind: 'task_list_snapshot',
          snapshot: event.snapshot,
          collapsed: false,
        },
      )
    }

    case 'plan_mode_updated': {
      const stateBeforeSnapshot = sealTrailingAssistantStreamChunks(
        sealAssistantDraftInPlace(state),
      )
      const lastSnapshot = getLastPlanSnapshotForSession(
        stateBeforeSnapshot.transcript,
        event.snapshot.sessionId,
      )
      if (
        lastSnapshot &&
        getPlanSnapshotSignature(lastSnapshot.snapshot) ===
          getPlanSnapshotSignature(event.snapshot)
      ) {
        return stateBeforeSnapshot
      }

      return appendTranscriptItem(stateBeforeSnapshot, {
        kind: 'plan_mode_snapshot',
        snapshot: event.snapshot,
      })
    }

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
          ...sealTrailingAssistantStreamChunks(state),
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

      return appendTranscriptItem(sealTrailingAssistantStreamChunks(state), {
        kind: 'time_separator',
        text: event.text,
      })
  }
}
