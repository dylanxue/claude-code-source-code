import { performance } from 'node:perf_hooks'
import React, { useEffect, useReducer, useRef, useState } from 'react'
import { Box, useApp, useInput, useStdin } from 'ink'
import { getCliErrorInfo } from '../cli/errorFormatting.js'
import { formatProgressThinkingLine } from '../cli/outputFormatting.js'
import {
  createInitialUiState,
  DEFAULT_COMPOSER_PLACEHOLDER,
  reduceUiEvent,
  type TranscriptItem,
  type UiEvent,
} from './state/index.js'
import {
  formatActiveTurnStatusText,
  formatCompletedTurnStatusText,
} from './presenters/turnStatusPresenter.js'
import { BottomDock } from './views/BottomDock.js'
import {
  getQuestionAnswerKey,
  getQuestionOptions,
  type QuestionDialogState,
} from './views/QuestionDialog.js'
import { ResumeSessionOverlay } from './views/ResumeSessionOverlay.js'
import {
  filterSkills,
  type SkillsMenuState,
} from './views/SkillsMenu.js'
import { TranscriptPane } from './views/TranscriptPane.js'
import type { WelcomeCardData } from '../cli/welcome.js'
import type { SessionHistoryEntry } from '../session/history.js'
import type { SkillStatus } from '../skills/enablement.js'
import type {
  AskUserQuestion,
  AskUserQuestionAnnotations,
  AskUserQuestionHostAction,
  AskUserQuestionHostResult,
  PermissionMode,
} from '../types/tool.js'
import {
  completeBottomSheetSelection,
  createBottomSheetForInput,
  moveBottomSheetSelection,
  type BottomSheetOptionsByCommand,
  type BottomSheetState,
} from './hooks/useBottomSheet.js'
import {
  completeSlashSuggestion,
  createSlashSuggestionState,
  getActiveSlashSuggestion,
  moveSlashSuggestionSelection,
} from './hooks/useSlashSuggestions.js'

const EXIT_COMMANDS = new Set([
  '/exit',
  'exit',
  'quit',
  '/quit',
  '.exit',
  '.quit',
])

export type BottomDockMeta = {
  cwd: string
  permissionLabel: string
  runtimeLabel: string
}

type ComposerInputState = {
  cursorIndex: number
  value: string
}

type PendingQuestionDialog = {
  answers: Record<string, string>
  annotations: AskUserQuestionAnnotations
  options: {
    permissionMode?: PermissionMode
    allowPreviewActions?: boolean
  }
  resolve: (result: Record<string, string> | AskUserQuestionHostResult) => void
}

type Props = {
  initialPrompt?: string
  welcomeCard: WelcomeCardData
  getBottomSheetOptions: () => BottomSheetOptionsByCommand
  getBottomDockMeta: () => BottomDockMeta
  onListResumeSessions: () => Promise<SessionHistoryEntry[]>
  onListSkillStatuses: () => Promise<SkillStatus[]>
  onLocalCommand: (
    prompt: string,
    options: {
      allowDuringActivePrompt: boolean
      onUiEvent: (event: UiEvent) => void
    },
  ) => Promise<boolean>
  onPrompt: (
    prompt: string,
    options: {
      askUserQuestions: (
        questions: AskUserQuestion[],
        options?: {
          permissionMode?: PermissionMode
          allowPreviewActions?: boolean
        },
      ) => Promise<Record<string, string> | AskUserQuestionHostResult>
      signal: AbortSignal
      onUiEvent: (event: UiEvent) => void
    },
  ) => Promise<void>
  onSetSkillEnabled: (
    skillName: string,
    enabled: boolean,
  ) => Promise<SkillStatus[]>
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'QueryLoopAbortError')
  )
}

function getInputChars(value: string): string[] {
  return [...value]
}

function clampCursorIndex(value: string, cursorIndex: number): number {
  return Math.min(Math.max(0, cursorIndex), getInputChars(value).length)
}

function createComposerInputState(value: string): ComposerInputState {
  return {
    value,
    cursorIndex: getInputChars(value).length,
  }
}

function moveComposerCursor(
  state: ComposerInputState,
  direction: -1 | 1,
): ComposerInputState {
  return {
    ...state,
    cursorIndex: clampCursorIndex(state.value, state.cursorIndex + direction),
  }
}

function insertComposerText(
  state: ComposerInputState,
  text: string,
): ComposerInputState {
  const chars = getInputChars(state.value)
  const textChars = getInputChars(text)
  const cursorIndex = clampCursorIndex(state.value, state.cursorIndex)
  chars.splice(cursorIndex, 0, ...textChars)
  return {
    value: chars.join(''),
    cursorIndex: cursorIndex + textChars.length,
  }
}

function deleteComposerBackward(
  state: ComposerInputState,
): ComposerInputState {
  const chars = getInputChars(state.value)
  const cursorIndex = clampCursorIndex(state.value, state.cursorIndex)
  if (cursorIndex === 0) {
    return state
  }

  chars.splice(cursorIndex - 1, 1)
  return {
    value: chars.join(''),
    cursorIndex: cursorIndex - 1,
  }
}

function deleteComposerForward(
  state: ComposerInputState,
): ComposerInputState {
  const chars = getInputChars(state.value)
  const cursorIndex = clampCursorIndex(state.value, state.cursorIndex)
  if (cursorIndex >= chars.length) {
    return state
  }

  chars.splice(cursorIndex, 1)
  return {
    value: chars.join(''),
    cursorIndex,
  }
}

function isBackspaceRawInput(input: string): boolean {
  return input === '\x7f' || input === '\b' || input === '\x1b\x7f'
}

function isForwardDeleteRawInput(input: string): boolean {
  return /^\x1b\[[0-9;]*3[~^$u]$/u.test(input)
}

export function isShiftTabRawInput(input: string): boolean {
  return input === '\x1b[Z'
}

export function formatQueuedPromptsForSubmission(prompts: string[]): string {
  return prompts.join('\n\n')
}

function isStaticTranscriptItemReady(item: TranscriptItem): boolean {
  if (item.kind === 'assistant_draft') {
    return false
  }

  if (item.kind === 'activity_group') {
    return item.entries.every(entry => entry.status === 'completed')
  }

  return true
}

export function getStaticTranscriptPrefixLength(
  transcript: TranscriptItem[],
): number {
  const firstMutableIndex = transcript.findIndex(
    item => !isStaticTranscriptItemReady(item),
  )

  return firstMutableIndex === -1 ? transcript.length : firstMutableIndex
}

function clampMenuIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0
  }

  return Math.max(0, Math.min(index, itemCount - 1))
}

function hasQuestionPreview(question: AskUserQuestion): boolean {
  return question.options.some(option => option.preview?.trim())
}

function getSelectedQuestionLabels(dialog: QuestionDialogState): string[] {
  const question = dialog.questions[dialog.currentQuestionIndex]
  if (!question) {
    return []
  }

  const options = getQuestionOptions(question)
  if (question.multiSelect) {
    return dialog.selectedOptionIndexes
      .map(index => options[index]?.label)
      .filter((label): label is string => Boolean(label))
  }

  const label = options[dialog.selectedOptionIndex]?.label
  return label ? [label] : []
}

function getSelectedQuestionPreview(dialog: QuestionDialogState): string | undefined {
  const question = dialog.questions[dialog.currentQuestionIndex]
  if (!question) {
    return undefined
  }

  const selectedLabel = getSelectedQuestionLabels(dialog)[0]
  if (!selectedLabel) {
    return undefined
  }

  return question.options.find(option => option.label === selectedLabel)?.preview?.trim()
}

function getQuestionNextAction(
  dialog: QuestionDialogState,
): AskUserQuestionHostAction | 'continue' {
  if (dialog.selectedActionIndex === 1) {
    return 'respond_to_agent'
  }

  if (dialog.selectedActionIndex === 2 && dialog.permissionMode === 'plan') {
    return 'finish_plan_interview'
  }

  return 'continue'
}

export function TuiApp({
  getBottomDockMeta,
  getBottomSheetOptions,
  initialPrompt,
  welcomeCard,
  onListResumeSessions,
  onListSkillStatuses,
  onLocalCommand,
  onPrompt,
  onSetSkillEnabled,
}: Props) {
  const { exit } = useApp()
  const { stdin } = useStdin()
  const [uiState, dispatch] = useReducer(
    reduceUiEvent,
    undefined,
    createInitialUiState,
  )
  const [bottomDockMeta, setBottomDockMeta] = useState(() =>
    getBottomDockMeta(),
  )
  const [composerInput, setComposerInput] = useState<ComposerInputState>({
    cursorIndex: 0,
    value: '',
  })
  const inputValue = composerInput.value
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [bottomSheet, setBottomSheet] = useState<BottomSheetState | undefined>(
    undefined,
  )
  const [resumeOverlay, setResumeOverlay] = useState<{
    errorText?: string
    isLoading: boolean
    searchQuery: string
    selectedIndex: number
    sessions: SessionHistoryEntry[]
  } | undefined>(undefined)
  const [skillsMenu, setSkillsMenu] = useState<SkillsMenuState | undefined>(
    undefined,
  )
  const [questionDialog, setQuestionDialog] = useState<
    QuestionDialogState | undefined
  >(undefined)
  const [isBusy, setIsBusy] = useState(false)
  const [activeTurnStartedAt, setActiveTurnStartedAt] = useState<
    number | undefined
  >(undefined)
  const [activeTurnElapsedMs, setActiveTurnElapsedMs] = useState(0)
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>([])
  const [staticTranscriptLength, setStaticTranscriptLength] = useState(0)
  const isWaitingForQuestionDialog = questionDialog !== undefined
  const activeControllerRef = useRef<AbortController | undefined>(undefined)
  const activePromptRef = useRef<string | undefined>(undefined)
  const foregroundInterruptedPromptRef = useRef<string | undefined>(undefined)
  const lastRawInputRef = useRef('')
  const queueRef = useRef<string[]>([])
  const pendingQuestionDialogRef = useRef<PendingQuestionDialog | undefined>(
    undefined,
  )
  const pendingAssistantDeltaRef = useRef('')
  const initialPromptHandledRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    const recordRawInput = (data: Buffer | string): void => {
      lastRawInputRef.current = data.toString()
    }

    stdin?.prependListener('data', recordRawInput)

    return () => {
      stdin?.removeListener('data', recordRawInput)
      mountedRef.current = false
      activeControllerRef.current?.abort()
      pendingQuestionDialogRef.current?.resolve({})
      pendingQuestionDialogRef.current = undefined
    }
  }, [])

  useEffect(() => {
    if (activeTurnStartedAt === undefined) {
      setActiveTurnElapsedMs(0)
      return
    }

    if (isWaitingForQuestionDialog) {
      return
    }

    setActiveTurnElapsedMs(performance.now() - activeTurnStartedAt)
    const timer = setInterval(() => {
      if (!mountedRef.current) {
        return
      }

      setActiveTurnElapsedMs(performance.now() - activeTurnStartedAt)
    }, 1_000)

    return () => {
      clearInterval(timer)
    }
  }, [activeTurnStartedAt, isWaitingForQuestionDialog])

  const dispatchAssistantStreamChunk = (text: string): void => {
    if (text.length === 0 || !mountedRef.current) {
      return
    }

    dispatch({
      type: 'assistant_stream_chunk',
      text,
    })
  }

  const flushPendingAssistantDelta = (): void => {
    const text = pendingAssistantDeltaRef.current
    pendingAssistantDeltaRef.current = ''
    dispatchAssistantStreamChunk(text)
  }

  const flushCompletedAssistantLines = (): void => {
    const text = pendingAssistantDeltaRef.current
    const lastLineBreakIndex = text.lastIndexOf('\n')
    if (lastLineBreakIndex === -1) {
      return
    }

    const stableText = text.slice(0, lastLineBreakIndex + 1)
    pendingAssistantDeltaRef.current = text.slice(lastLineBreakIndex + 1)
    dispatchAssistantStreamChunk(stableText)
  }

  const dispatchUiEvent = (event: UiEvent): void => {
    if (
      event.type === 'assistant_progress_message' &&
      event.text.trim() === formatProgressThinkingLine()
    ) {
      return
    }

    if (event.type === 'assistant_text_delta') {
      pendingAssistantDeltaRef.current += event.text
      flushCompletedAssistantLines()
      return
    }

    if (
      event.type === 'turn_interrupted' &&
      foregroundInterruptedPromptRef.current === event.prompt
    ) {
      return
    }

    if (event.type === 'turn_completed') {
      flushPendingAssistantDelta()
    } else if (event.type === 'turn_interrupted') {
      flushPendingAssistantDelta()
    }

    if (mountedRef.current) {
      dispatch(event)
    }
  }

  const interruptActivePrompt = (): boolean => {
    const controller = activeControllerRef.current
    if (!controller) {
      return false
    }

    if (!controller.signal.aborted) {
      const prompt = activePromptRef.current
      controller.abort()
      if (prompt) {
        dispatchUiEvent({
          type: 'turn_interrupted',
          prompt,
        })
        foregroundInterruptedPromptRef.current = prompt
      }
      if (mountedRef.current) {
        setActiveTurnStartedAt(undefined)
        setIsBusy(false)
      }
    }
    return true
  }

  const refreshMeta = (): void => {
    if (mountedRef.current) {
      setBottomDockMeta(getBottomDockMeta())
    }
  }

  const replaceQueue = (nextQueue: string[]): void => {
    queueRef.current = nextQueue
    if (mountedRef.current) {
      setQueuedPrompts(nextQueue)
    }
  }

  const runPrompt = async (prompt: string): Promise<void> => {
    const controller = new AbortController()
    const turnStartedAt = performance.now()
    activeControllerRef.current = controller
    activePromptRef.current = prompt
    foregroundInterruptedPromptRef.current = undefined
    if (mountedRef.current) {
      setIsBusy(true)
      setActiveTurnStartedAt(turnStartedAt)
      setActiveTurnElapsedMs(0)
    }

    try {
      await onPrompt(prompt, {
        askUserQuestions: createQuestionDialog,
        signal: controller.signal,
        onUiEvent: dispatchUiEvent,
      })
    } catch (error) {
      if (!isAbortLikeError(error)) {
        dispatchUiEvent({
          type: 'system_notice',
          text: getCliErrorInfo(error).formattedText,
        })
      }
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = undefined
      }
      if (activePromptRef.current === prompt) {
        activePromptRef.current = undefined
      }

      refreshMeta()

      if (mountedRef.current) {
        setActiveTurnStartedAt(undefined)
      }

      const durationMs = performance.now() - turnStartedAt
      if (!controller.signal.aborted && durationMs >= 1_000) {
        dispatchUiEvent({
          type: 'time_separator_added',
          text: formatCompletedTurnStatusText(durationMs),
        })
      }

      if (queueRef.current.length > 0) {
        const nextPrompts = queueRef.current
        replaceQueue([])
        void runPrompt(formatQueuedPromptsForSubmission(nextPrompts))
        return
      }

      if (mountedRef.current) {
        setIsBusy(false)
      }
    }
  }

  const submitPrompt = async (prompt: string): Promise<void> => {
    const trimmed = prompt.trim()
    if (trimmed.length === 0) {
      return
    }

    const normalizedPrompt = trimmed.toLowerCase()
    if (EXIT_COMMANDS.has(normalizedPrompt)) {
      activeControllerRef.current?.abort()
      exit()
      return
    }

    if (normalizedPrompt === '/resume') {
      void openResumeOverlay()
      return
    }

    if (normalizedPrompt === '/skills') {
      setComposerInput({ value: '', cursorIndex: 0 })
      void openSkillsMenu()
      return
    }

    const handledLocally = await onLocalCommand(trimmed, {
      allowDuringActivePrompt: Boolean(activeControllerRef.current),
      onUiEvent: dispatchUiEvent,
    })
    refreshMeta()
    if (handledLocally) {
      return
    }

    if (activeControllerRef.current) {
      const nextQueue = [...queueRef.current, trimmed]
      replaceQueue(nextQueue)
      return
    }

    void runPrompt(trimmed)
  }

  const buildSlashSuggestionState = (value: string, activeIndex = activeSuggestionIndex) =>
    createSlashSuggestionState(value, undefined, activeIndex)

  const buildBottomSheet = (value: string): BottomSheetState | undefined =>
    createBottomSheetForInput(value, getBottomSheetOptions())

  const getFilteredResumeSessions = (
    overlay: NonNullable<typeof resumeOverlay>,
  ): SessionHistoryEntry[] => {
    const query = overlay.searchQuery.trim().toLowerCase()
    if (query.length === 0) {
      return overlay.sessions
    }

    return overlay.sessions.filter(session =>
      [
        session.conversationTitle,
        session.meta.sessionId,
        session.meta.cwd,
      ]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLowerCase().includes(query)),
    )
  }

  const openSkillsMenu = async (): Promise<void> => {
    setBottomSheet(undefined)
    setActiveSuggestionIndex(0)
    setSkillsMenu({
      isLoading: true,
      mode: 'root',
      searchQuery: '',
      selectedIndex: 0,
      skills: [],
    })

    try {
      const skills = await onListSkillStatuses()
      if (!mountedRef.current) {
        return
      }

      setSkillsMenu({
        isLoading: false,
        mode: 'root',
        searchQuery: '',
        selectedIndex: 0,
        skills,
      })
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      setSkillsMenu({
        errorText: getCliErrorInfo(error).formattedText,
        isLoading: false,
        mode: 'root',
        searchQuery: '',
        selectedIndex: 0,
        skills: [],
      })
    }
  }

  const moveSkillsSelection = (direction: 1 | -1): void => {
    setSkillsMenu(menu => {
      if (!menu) {
        return menu
      }

      const itemCount =
        menu.mode === 'root'
          ? 2
          : filterSkills(menu.skills, menu.searchQuery).length

      if (itemCount === 0) {
        return menu
      }

      return {
        ...menu,
        selectedIndex: (menu.selectedIndex + direction + itemCount) % itemCount,
      }
    })
  }

  const setSkillsSearchQuery = (updater: (value: string) => string): void => {
    setSkillsMenu(menu =>
      menu
        ? {
            ...menu,
            searchQuery: updater(menu.searchQuery),
            selectedIndex: 0,
          }
        : menu,
    )
  }

  const selectRootSkillsMenuItem = (selectedIndex: number): void => {
    setSkillsMenu(menu =>
      menu
        ? {
            ...menu,
            mode: selectedIndex === 0 ? 'list' : 'configure',
            searchQuery: '',
            selectedIndex: 0,
          }
        : menu,
    )
  }

  const insertSelectedSkillName = (menu: SkillsMenuState): void => {
    const skills = filterSkills(menu.skills, menu.searchQuery)
    const selectedSkill = skills[clampMenuIndex(menu.selectedIndex, skills.length)]
    if (!selectedSkill) {
      return
    }

    const nextValue = `${selectedSkill.name} `
    setComposerInput({
      value: nextValue,
      cursorIndex: getInputChars(nextValue).length,
    })
    setSkillsMenu(undefined)
    setActiveSuggestionIndex(0)
  }

  const toggleSelectedSkill = async (menu: SkillsMenuState): Promise<void> => {
    const skills = filterSkills(menu.skills, menu.searchQuery)
    const selectedIndex = clampMenuIndex(menu.selectedIndex, skills.length)
    const selectedSkill = skills[selectedIndex]
    if (!selectedSkill) {
      return
    }

    setSkillsMenu({
      ...menu,
      isLoading: true,
    })

    try {
      const nextSkills = await onSetSkillEnabled(
        selectedSkill.name,
        !selectedSkill.enabled,
      )
      if (!mountedRef.current) {
        return
      }

      const nextFilteredSkills = filterSkills(nextSkills, menu.searchQuery)
      setSkillsMenu({
        ...menu,
        isLoading: false,
        selectedIndex: clampMenuIndex(selectedIndex, nextFilteredSkills.length),
        skills: nextSkills,
      })
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      setSkillsMenu({
        ...menu,
        errorText: getCliErrorInfo(error).formattedText,
        isLoading: false,
      })
    }
  }

  const submitSkillsMenuSelection = (): void => {
    if (!skillsMenu || skillsMenu.isLoading) {
      return
    }

    if (skillsMenu.mode === 'root') {
      selectRootSkillsMenuItem(skillsMenu.selectedIndex)
      return
    }

    if (skillsMenu.mode === 'list') {
      insertSelectedSkillName(skillsMenu)
      return
    }

    void toggleSelectedSkill(skillsMenu)
  }

  const createQuestionDialog = (
    questions: AskUserQuestion[],
    options: {
      permissionMode?: PermissionMode
      allowPreviewActions?: boolean
    } = {},
  ): Promise<Record<string, string> | AskUserQuestionHostResult> =>
    new Promise(resolve => {
      pendingQuestionDialogRef.current = {
        answers: {},
        annotations: {},
        options,
        resolve,
      }
      setQuestionDialog({
        allowPreviewActions: options.allowPreviewActions === true,
        currentQuestionIndex: 0,
        customInput: '',
        mode: 'select',
        notesInput: '',
        permissionMode: options.permissionMode,
        questions,
        selectedActionIndex: 0,
        selectedOptionIndexes: [],
        selectedOptionIndex: 0,
      })
    })

  const resolveQuestionDialog = (
    result: Record<string, string> | AskUserQuestionHostResult,
  ): void => {
    const pending = pendingQuestionDialogRef.current
    pendingQuestionDialogRef.current = undefined
    setQuestionDialog(undefined)
    pending?.resolve(result)
  }

  const advanceQuestionDialog = (dialog: QuestionDialogState): void => {
    const pending = pendingQuestionDialogRef.current
    if (!pending) {
      setQuestionDialog(undefined)
      return
    }

    const nextIndex = dialog.currentQuestionIndex + 1
    if (nextIndex >= dialog.questions.length) {
      const hasAnnotations = Object.keys(pending.annotations).length > 0
      if (Object.keys(pending.annotations).length > 0 || pending.options.allowPreviewActions) {
        resolveQuestionDialog({
          answers: pending.answers,
          ...(hasAnnotations ? { annotations: pending.annotations } : {}),
          action: pending.options.allowPreviewActions ? 'submit_answers' : undefined,
        })
        return
      }

      resolveQuestionDialog(pending.answers)
      return
    }

    setQuestionDialog({
      ...dialog,
      currentQuestionIndex: nextIndex,
      customInput: '',
      mode: 'select',
      notesInput: '',
      selectedActionIndex: 0,
      selectedOptionIndexes: [],
      selectedOptionIndex: 0,
    })
  }

  const commitQuestionAnswer = (
    dialog: QuestionDialogState,
    customText?: string,
  ): void => {
    const pending = pendingQuestionDialogRef.current
    const question = dialog.questions[dialog.currentQuestionIndex]
    if (!pending || !question) {
      return
    }

    const labels =
      customText === undefined
        ? getSelectedQuestionLabels(dialog).filter(label => label !== 'Other')
        : []
    const answerParts = [...labels, ...(customText ? [customText] : [])]
    if (answerParts.length === 0) {
      return
    }

    pending.answers[getQuestionAnswerKey(question)] = answerParts.join(', ')
    if (
      hasQuestionPreview(question) &&
      dialog.allowPreviewActions &&
      customText === undefined
    ) {
      setQuestionDialog({
        ...dialog,
        mode: 'notes',
        notesInput: '',
      })
      return
    }

    advanceQuestionDialog(dialog)
  }

  const submitQuestionDialogSelection = (): void => {
    if (!questionDialog) {
      return
    }

    const pending = pendingQuestionDialogRef.current
    const question = questionDialog.questions[questionDialog.currentQuestionIndex]
    if (!pending || !question) {
      return
    }

    if (questionDialog.mode === 'custom') {
      const customText = questionDialog.customInput.trim()
      if (customText.length > 0) {
        commitQuestionAnswer(questionDialog, customText)
      }
      return
    }

    if (questionDialog.mode === 'notes') {
      const preview = getSelectedQuestionPreview(questionDialog)
      const notes = questionDialog.notesInput.trim()
      if (preview || notes) {
        pending.annotations[getQuestionAnswerKey(question)] = {
          ...(preview ? { preview } : {}),
          ...(notes ? { notes } : {}),
        }
      }
      setQuestionDialog({
        ...questionDialog,
        mode: 'next_action',
        selectedActionIndex: 0,
      })
      return
    }

    if (questionDialog.mode === 'next_action') {
      const action = getQuestionNextAction(questionDialog)
      if (action === 'continue') {
        advanceQuestionDialog(questionDialog)
        return
      }

      const hasAnnotations = Object.keys(pending.annotations).length > 0
      resolveQuestionDialog({
        answers: pending.answers,
        ...(hasAnnotations ? { annotations: pending.annotations } : {}),
        action,
      })
      return
    }

    const options = getQuestionOptions(question)
    const selectedOption = options[questionDialog.selectedOptionIndex]
    if (!selectedOption) {
      return
    }

    if (selectedOption.label === 'Other') {
      setQuestionDialog({
        ...questionDialog,
        mode: 'custom',
        customInput: '',
      })
      return
    }

    if (question.multiSelect) {
      if (questionDialog.selectedOptionIndexes.length === 0) {
        return
      }
      commitQuestionAnswer(questionDialog)
      return
    }

    commitQuestionAnswer(questionDialog)
  }

  const moveQuestionDialogSelection = (direction: 1 | -1): void => {
    setQuestionDialog(dialog => {
      if (!dialog) {
        return dialog
      }

      if (dialog.mode === 'next_action') {
        const itemCount = dialog.permissionMode === 'plan' ? 3 : 2
        return {
          ...dialog,
          selectedActionIndex:
            (dialog.selectedActionIndex + direction + itemCount) % itemCount,
        }
      }

      if (dialog.mode !== 'select') {
        return dialog
      }

      const question = dialog.questions[dialog.currentQuestionIndex]
      const itemCount = question ? getQuestionOptions(question).length : 0
      if (itemCount === 0) {
        return dialog
      }

      return {
        ...dialog,
        selectedOptionIndex:
          (dialog.selectedOptionIndex + direction + itemCount) % itemCount,
      }
    })
  }

  const toggleQuestionDialogSelection = (): void => {
    setQuestionDialog(dialog => {
      const question = dialog?.questions[dialog.currentQuestionIndex]
      if (!dialog || !question?.multiSelect || dialog.mode !== 'select') {
        return dialog
      }

      const selected = new Set(dialog.selectedOptionIndexes)
      if (selected.has(dialog.selectedOptionIndex)) {
        selected.delete(dialog.selectedOptionIndex)
      } else {
        selected.add(dialog.selectedOptionIndex)
      }

      return {
        ...dialog,
        selectedOptionIndexes: [...selected].sort((left, right) => left - right),
      }
    })
  }

  const updateQuestionDialogText = (
    updater: (value: string) => string,
  ): void => {
    setQuestionDialog(dialog => {
      if (!dialog) {
        return dialog
      }

      if (dialog.mode === 'custom') {
        return {
          ...dialog,
          customInput: updater(dialog.customInput),
        }
      }

      if (dialog.mode === 'notes') {
        return {
          ...dialog,
          notesInput: updater(dialog.notesInput),
        }
      }

      return dialog
    })
  }

  const closeOrBackQuestionDialog = (): void => {
    if (!questionDialog) {
      return
    }

    if (questionDialog.mode === 'custom' || questionDialog.mode === 'notes') {
      setQuestionDialog({
        ...questionDialog,
        mode: 'select',
        customInput: '',
        notesInput: '',
      })
      return
    }

    if (questionDialog.mode === 'next_action') {
      setQuestionDialog({
        ...questionDialog,
        mode: 'notes',
        selectedActionIndex: 0,
      })
      return
    }

    resolveQuestionDialog({})
  }

  const closeOrBackSkillsMenu = (): void => {
    setSkillsMenu(menu => {
      if (!menu) {
        return menu
      }

      if (menu.mode === 'root') {
        return undefined
      }

      return {
        ...menu,
        mode: 'root',
        searchQuery: '',
        selectedIndex: 0,
      }
    })
  }

  const completeActiveSuggestion = (): boolean => {
    const suggestionState = buildSlashSuggestionState(inputValue)
    const suggestion = getActiveSlashSuggestion(suggestionState)
    if (!suggestion) {
      return false
    }

    const completedInput = completeSlashSuggestion(inputValue, suggestion)
    if (suggestion.name === '/skills') {
      setComposerInput({ value: '', cursorIndex: 0 })
      setActiveSuggestionIndex(0)
      void openSkillsMenu()
      return true
    }

    const nextSheet = buildBottomSheet(completedInput)
    setComposerInput({
      value: completedInput,
      cursorIndex: getInputChars(completedInput).length,
    })
    setActiveSuggestionIndex(0)
    if (nextSheet) {
      setBottomSheet(nextSheet)
    } else {
      setComposerInput({ value: '', cursorIndex: 0 })
      void submitPrompt(completedInput)
    }
    return true
  }

  const maybeOpenBottomSheet = (): boolean => {
    const nextSheet = buildBottomSheet(inputValue)
    if (!nextSheet) {
      return false
    }

    setBottomSheet(nextSheet)
    return true
  }

  const openResumeOverlay = async (): Promise<void> => {
    setBottomSheet(undefined)
    setActiveSuggestionIndex(0)
    setResumeOverlay({
      isLoading: true,
      searchQuery: '',
      selectedIndex: 0,
      sessions: [],
    })

    try {
      const sessions = await onListResumeSessions()
      if (!mountedRef.current) {
        return
      }

      setResumeOverlay({
        isLoading: false,
        searchQuery: '',
        selectedIndex: 0,
        sessions,
      })
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      setResumeOverlay({
        errorText: getCliErrorInfo(error).formattedText,
        isLoading: false,
        searchQuery: '',
        selectedIndex: 0,
        sessions: [],
      })
    }
  }

  const moveResumeSelection = (direction: 1 | -1): void => {
    setResumeOverlay(overlay => {
      if (!overlay) {
        return overlay
      }

      const filteredSessions = getFilteredResumeSessions(overlay)
      if (filteredSessions.length === 0) {
        return overlay
      }

      return {
        ...overlay,
        selectedIndex:
          (overlay.selectedIndex + direction + filteredSessions.length) %
          filteredSessions.length,
      }
    })
  }

  const submitSelectedResumeSession = (): void => {
    const sessionId = resumeOverlay
      ? getFilteredResumeSessions(resumeOverlay)[resumeOverlay.selectedIndex]?.meta
          .sessionId
      : undefined
    if (!sessionId) {
      return
    }

    setResumeOverlay(undefined)
    setComposerInput({ value: '', cursorIndex: 0 })
    void submitPrompt(`/resume ${sessionId}`)
  }

  useEffect(() => {
    if (!initialPrompt || initialPromptHandledRef.current) {
      return
    }

    initialPromptHandledRef.current = true
    void submitPrompt(initialPrompt)
  }, [initialPrompt])

  useEffect(() => {
    const nextStaticLength = getStaticTranscriptPrefixLength(uiState.transcript)
    setStaticTranscriptLength(currentLength => {
      if (uiState.transcript.length < currentLength) {
        return nextStaticLength
      }

      return Math.max(currentLength, nextStaticLength)
    })
  }, [uiState.transcript])

  useInput((input, key) => {
    const normalizedInput = input.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n')
    const rawInput = lastRawInputRef.current
    const isTerminalBackspace =
      key.backspace || isBackspaceRawInput(input) || isBackspaceRawInput(rawInput)
    const isTerminalForwardDelete =
      key.delete && isForwardDeleteRawInput(rawInput)

    if (key.ctrl && input === 'c') {
      activeControllerRef.current?.abort()
      exit()
      return
    }

    if (
      isShiftTabRawInput(rawInput) &&
      !resumeOverlay &&
      !questionDialog &&
      !skillsMenu &&
      !bottomSheet
    ) {
      setComposerInput({ value: '', cursorIndex: 0 })
      setActiveSuggestionIndex(0)
      void submitPrompt('/plan')
      return
    }

    if (resumeOverlay) {
      if (key.escape) {
        setResumeOverlay(undefined)
        return
      }

      if (key.upArrow) {
        moveResumeSelection(-1)
        return
      }

      if (key.downArrow || key.tab) {
        moveResumeSelection(1)
        return
      }

      if (isTerminalBackspace || (key.delete && !isTerminalForwardDelete)) {
        setResumeOverlay(overlay =>
          overlay
            ? {
                ...overlay,
                searchQuery: overlay.searchQuery.slice(0, -1),
                selectedIndex: 0,
              }
            : overlay,
        )
        return
      }

      if (key.return || normalizedInput.includes('\n')) {
        submitSelectedResumeSession()
        return
      }

      if (!key.ctrl && !key.meta && normalizedInput.length > 0) {
        setResumeOverlay(overlay =>
          overlay
            ? {
                ...overlay,
                searchQuery: `${overlay.searchQuery}${normalizedInput}`,
                selectedIndex: 0,
              }
            : overlay,
        )
        return
      }

      return
    }

    if (key.escape) {
      if (questionDialog) {
        closeOrBackQuestionDialog()
        return
      }

      if (skillsMenu) {
        closeOrBackSkillsMenu()
        return
      }

      if (bottomSheet) {
        setComposerInput(createComposerInputState(bottomSheet.dismissInputValue))
        setActiveSuggestionIndex(0)
        setBottomSheet(undefined)
        return
      }

      if (interruptActivePrompt()) {
        return
      }

      setComposerInput(createComposerInputState(''))
      return
    }

    if (questionDialog) {
      if (key.upArrow) {
        moveQuestionDialogSelection(-1)
        return
      }

      if (key.downArrow || key.tab) {
        moveQuestionDialogSelection(1)
        return
      }

      if (input === ' ' && questionDialog.mode === 'select') {
        toggleQuestionDialogSelection()
        return
      }

      if (isTerminalBackspace || (key.delete && !isTerminalForwardDelete)) {
        updateQuestionDialogText(value => value.slice(0, -1))
        return
      }

      if (key.return || normalizedInput.includes('\n')) {
        submitQuestionDialogSelection()
        return
      }

      if (
        (questionDialog.mode === 'custom' || questionDialog.mode === 'notes') &&
        !key.ctrl &&
        !key.meta &&
        normalizedInput.length > 0
      ) {
        updateQuestionDialogText(value => `${value}${normalizedInput}`)
        return
      }

      return
    }

    if (skillsMenu) {
      if (key.upArrow) {
        moveSkillsSelection(-1)
        return
      }

      if (key.downArrow || key.tab) {
        moveSkillsSelection(1)
        return
      }

      if (
        skillsMenu.mode !== 'root' &&
        (isTerminalBackspace || (key.delete && !isTerminalForwardDelete))
      ) {
        setSkillsSearchQuery(value => value.slice(0, -1))
        return
      }

      if (key.return || normalizedInput.includes('\n')) {
        submitSkillsMenuSelection()
        return
      }

      if (skillsMenu.mode === 'configure' && input === ' ') {
        submitSkillsMenuSelection()
        return
      }

      if (
        skillsMenu.mode !== 'root' &&
        !key.ctrl &&
        !key.meta &&
        normalizedInput.length > 0
      ) {
        setSkillsSearchQuery(value => `${value}${normalizedInput}`)
        return
      }

      return
    }

    if (bottomSheet) {
      if (key.upArrow) {
        setBottomSheet(sheet =>
          sheet ? moveBottomSheetSelection(sheet, -1) : sheet,
        )
        return
      }

      if (key.downArrow || key.tab) {
        setBottomSheet(sheet =>
          sheet ? moveBottomSheetSelection(sheet, 1) : sheet,
        )
        return
      }

      if (key.return || normalizedInput.includes('\n')) {
        const completedInput = completeBottomSheetSelection(bottomSheet)
        setBottomSheet(undefined)
        setComposerInput({ value: '', cursorIndex: 0 })
        void submitPrompt(completedInput)
        return
      }

      return
    }

    const suggestionState = buildSlashSuggestionState(inputValue)
    const hasSuggestions = suggestionState.suggestions.length > 0

    if (hasSuggestions && key.upArrow) {
      const nextState = moveSlashSuggestionSelection(suggestionState, -1)
      setActiveSuggestionIndex(nextState.activeIndex)
      return
    }

    if (hasSuggestions && key.downArrow) {
      const nextState = moveSlashSuggestionSelection(suggestionState, 1)
      setActiveSuggestionIndex(nextState.activeIndex)
      return
    }

    if (hasSuggestions && key.tab) {
      completeActiveSuggestion()
      return
    }

    if (key.return || normalizedInput.includes('\n')) {
      if (hasSuggestions && completeActiveSuggestion()) {
        return
      }

      if (maybeOpenBottomSheet()) {
        return
      }

      const submittedPrompt = insertComposerText(
        composerInput,
        normalizedInput.split('\n')[0] ?? '',
      ).value
      setComposerInput({ value: '', cursorIndex: 0 })
      setActiveSuggestionIndex(0)
      void submitPrompt(submittedPrompt)
      return
    }

    if (key.leftArrow) {
      setComposerInput(value => moveComposerCursor(value, -1))
      return
    }

    if (key.rightArrow) {
      setComposerInput(value => moveComposerCursor(value, 1))
      return
    }

    if (isTerminalBackspace || (key.delete && !isTerminalForwardDelete)) {
      setComposerInput(value => {
        const nextValue = deleteComposerBackward(value)
        setActiveSuggestionIndex(0)
        return nextValue
      })
      return
    }

    if (isTerminalForwardDelete) {
      setComposerInput(value => {
        const nextValue = deleteComposerForward(value)
        setActiveSuggestionIndex(0)
        return nextValue
      })
      return
    }

    if (key.ctrl || key.meta || key.tab) {
      return
    }

    if (normalizedInput.length > 0) {
      setComposerInput(value => {
        const nextValue = insertComposerText(value, normalizedInput)
        setActiveSuggestionIndex(0)
        return nextValue
      })
    }
  })

  const slashSuggestionState = buildSlashSuggestionState(inputValue)

  if (resumeOverlay) {
    const filteredResumeSessions = getFilteredResumeSessions(resumeOverlay)

    return (
      <ResumeSessionOverlay
        errorText={resumeOverlay.errorText}
        isLoading={resumeOverlay.isLoading}
        searchQuery={resumeOverlay.searchQuery}
        selectedIndex={resumeOverlay.selectedIndex}
        sessions={filteredResumeSessions}
      />
    )
  }

  return (
    <Box flexDirection="column" height="100%">
      <TranscriptPane
        activeStatusText={
          activeTurnStartedAt === undefined || isWaitingForQuestionDialog
            ? undefined
            : formatActiveTurnStatusText(activeTurnElapsedMs)
        }
        entries={uiState.transcript.slice(staticTranscriptLength)}
        staticEntries={uiState.transcript.slice(0, staticTranscriptLength)}
        welcomeCard={welcomeCard}
      />
      <BottomDock
        activeSuggestionIndex={slashSuggestionState.activeIndex}
        bottomSheet={bottomSheet}
        cursorIndex={composerInput.cursorIndex}
        cwd={bottomDockMeta.cwd}
        inputValue={inputValue}
        isBusy={isBusy}
        permissionLabel={bottomDockMeta.permissionLabel}
        placeholder={
          isBusy
            ? 'Queue a prompt while DCLAW is working'
            : DEFAULT_COMPOSER_PLACEHOLDER
        }
        questionDialog={questionDialog}
        queuedPrompts={queuedPrompts}
        runtimeLabel={bottomDockMeta.runtimeLabel}
        skillsMenu={skillsMenu}
        slashSuggestions={slashSuggestionState.suggestions}
      />
    </Box>
  )
}
