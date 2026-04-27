export type ActivityEntryStatus = 'started' | 'completed'

export type ActivityEntry = {
  toolUseId: string
  text: string
  status: ActivityEntryStatus
}

export type StructuredCardEntry =
  | {
      kind: 'row'
      label: string
      value: string
    }
  | {
      kind: 'text'
      text: string
    }
  | {
      kind: 'separator'
    }

export type TranscriptItem =
  | {
      id: string
      kind: 'system'
      text: string
    }
  | {
      id: string
      kind: 'user_prompt'
      text: string
    }
  | {
      id: string
      kind: 'user_command'
      text: string
    }
  | {
      id: string
      kind: 'assistant_note'
      text: string
    }
  | {
      id: string
      kind: 'assistant_draft'
      text: string
    }
  | {
      id: string
      kind: 'activity_group'
      title: string
      entries: ActivityEntry[]
    }
  | {
      id: string
      kind: 'structured_card'
      title: string
      entries: StructuredCardEntry[]
    }
  | {
      id: string
      kind: 'time_separator'
      text: string
    }

export type BottomDockMode =
  | 'default'
  | 'suggesting'
  | 'sheet_open'
  | 'blocked'

export type BottomDockState = {
  mode: BottomDockMode
  inputValue: string
  placeholder: string
  runtimeLabel?: string
  permissionLabel?: string
  cwdLabel?: string
}

export type OverlayState =
  | {
      kind: 'none'
    }
  | {
      kind: 'permission'
      title: string
      prompt: string
    }
  | {
      kind: 'questionnaire'
      title: string
    }

export type UiState = {
  transcript: TranscriptItem[]
  bottomDock: BottomDockState
  overlay: OverlayState
  nextTranscriptItemId: number
  activeTurn: {
    prompt?: string
    promptKind?: 'prompt' | 'slash'
    assistantDraftId?: string
    activityToolGroupIds?: Record<string, string>
  }
}

export type UiEvent =
  | {
      type: 'command_logged'
      prompt: string
    }
  | {
      type: 'turn_started'
      prompt: string
      promptKind: 'prompt' | 'slash'
    }
  | {
      type: 'assistant_text_delta'
      text: string
    }
  | {
      type: 'assistant_progress_message'
      text: string
    }
  | {
      type: 'tool_use_started'
      toolUseId: string
      text: string
      title?: string
    }
  | {
      type: 'tool_result_received'
      toolUseId: string
      text: string
    }
  | {
      type: 'system_notice'
      text: string
    }
  | {
      type: 'structured_card_added'
      title: string
      entries: StructuredCardEntry[]
    }
  | {
      type: 'turn_completed'
      outputText: string
    }
  | {
      type: 'turn_interrupted'
      prompt: string
    }
  | {
      type: 'transcript_cleared'
    }
  | {
      type: 'time_separator_added'
      text: string
    }

export const DEFAULT_COMPOSER_PLACEHOLDER =
  'Ask DCLAW or type / for commands'
