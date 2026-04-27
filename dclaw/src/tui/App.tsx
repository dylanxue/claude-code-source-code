import { performance } from 'node:perf_hooks'
import React, { useEffect, useReducer, useRef, useState } from 'react'
import { Box, useApp, useInput } from 'ink'
import { getCliErrorInfo } from '../cli/errorFormatting.js'
import { formatProgressThinkingLine } from '../cli/verboseEvents.js'
import {
  createInitialUiState,
  DEFAULT_COMPOSER_PLACEHOLDER,
  reduceUiEvent,
  type UiEvent,
} from './state/index.js'
import {
  formatActiveTurnStatusText,
  formatCompletedTurnStatusText,
} from './presenters/turnStatusPresenter.js'
import { BottomDock } from './views/BottomDock.js'
import { TranscriptPane } from './views/TranscriptPane.js'

const EXIT_COMMANDS = new Set([
  '/exit',
  'exit',
  'quit',
  '/quit',
  '.exit',
  '.quit',
])

const INTERRUPT_COMMANDS = new Set([
  '/interrupt',
  '/cancel',
  '/abort',
])

const CLEAR_SCREEN_COMMANDS = new Set(['/cls'])

export type BottomDockMeta = {
  cwd: string
  permissionLabel: string
  runtimeLabel: string
}

type Props = {
  initialPrompt?: string
  getBottomDockMeta: () => BottomDockMeta
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
      signal: AbortSignal
      onUiEvent: (event: UiEvent) => void
    },
  ) => Promise<void>
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'QueryLoopAbortError')
  )
}

export function TuiApp({
  getBottomDockMeta,
  initialPrompt,
  onLocalCommand,
  onPrompt,
}: Props) {
  const { exit } = useApp()
  const [uiState, dispatch] = useReducer(
    reduceUiEvent,
    undefined,
    createInitialUiState,
  )
  const [bottomDockMeta, setBottomDockMeta] = useState(() =>
    getBottomDockMeta(),
  )
  const [inputValue, setInputValue] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [queueCount, setQueueCount] = useState(0)
  const [activeTurnStartedAt, setActiveTurnStartedAt] = useState<
    number | undefined
  >(undefined)
  const [activeTurnElapsedMs, setActiveTurnElapsedMs] = useState(0)
  const activeControllerRef = useRef<AbortController | undefined>(undefined)
  const queueRef = useRef<string[]>([])
  const initialPromptHandledRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      activeControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (activeTurnStartedAt === undefined) {
      setActiveTurnElapsedMs(0)
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
  }, [activeTurnStartedAt])

  const dispatchUiEvent = (event: UiEvent): void => {
    if (
      event.type === 'assistant_progress_message' &&
      event.text.trim() === formatProgressThinkingLine()
    ) {
      return
    }

    if (mountedRef.current) {
      dispatch(event)
    }
  }

  const refreshMeta = (): void => {
    if (mountedRef.current) {
      setBottomDockMeta(getBottomDockMeta())
    }
  }

  const replaceQueue = (nextQueue: string[]): void => {
    queueRef.current = nextQueue
    if (mountedRef.current) {
      setQueueCount(nextQueue.length)
    }
  }

  const runPrompt = async (prompt: string): Promise<void> => {
    const controller = new AbortController()
    const turnStartedAt = performance.now()
    activeControllerRef.current = controller
    if (mountedRef.current) {
      setIsBusy(true)
      setActiveTurnStartedAt(turnStartedAt)
      setActiveTurnElapsedMs(0)
    }

    try {
      await onPrompt(prompt, {
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

      const [nextPrompt, ...remaining] = queueRef.current
      if (nextPrompt) {
        replaceQueue(remaining)
        void runPrompt(nextPrompt)
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

    if (CLEAR_SCREEN_COMMANDS.has(normalizedPrompt)) {
      dispatchUiEvent({
        type: 'transcript_cleared',
      })
      return
    }

    if (INTERRUPT_COMMANDS.has(normalizedPrompt)) {
      dispatchUiEvent({
        type: 'command_logged',
        prompt: trimmed,
      })
      if (activeControllerRef.current) {
        activeControllerRef.current.abort()
      } else {
        dispatchUiEvent({
          type: 'system_notice',
          text: 'No active response to interrupt.',
        })
      }
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
      dispatchUiEvent({
        type: 'system_notice',
        text: `Queued prompt. Pending prompts: ${nextQueue.length}`,
      })
      return
    }

    void runPrompt(trimmed)
  }

  useEffect(() => {
    if (!initialPrompt || initialPromptHandledRef.current) {
      return
    }

    initialPromptHandledRef.current = true
    void submitPrompt(initialPrompt)
  }, [initialPrompt])

  useInput((input, key) => {
    const normalizedInput = input.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n')

    if (key.ctrl && input === 'c') {
      activeControllerRef.current?.abort()
      exit()
      return
    }

    if (key.escape) {
      if (activeControllerRef.current) {
        activeControllerRef.current.abort()
        return
      }

      setInputValue('')
      return
    }

    if (key.return || normalizedInput.includes('\n')) {
      const submittedPrompt = `${inputValue}${normalizedInput.split('\n')[0] ?? ''}`
      setInputValue('')
      void submitPrompt(submittedPrompt)
      return
    }

    if (key.backspace || key.delete) {
      setInputValue(value => value.slice(0, -1))
      return
    }

    if (key.ctrl || key.meta || key.tab) {
      return
    }

    if (normalizedInput.length > 0) {
      setInputValue(value => value + normalizedInput)
    }
  })

  return (
    <Box flexDirection="column" height="100%">
      <TranscriptPane
        activeStatusText={
          activeTurnStartedAt === undefined
            ? undefined
            : formatActiveTurnStatusText(activeTurnElapsedMs)
        }
        entries={uiState.transcript}
      />
      <BottomDock
        cwd={bottomDockMeta.cwd}
        inputValue={inputValue}
        isBusy={isBusy}
        permissionLabel={bottomDockMeta.permissionLabel}
        placeholder={
          isBusy
            ? 'Queue a prompt while DCLAW is working'
            : DEFAULT_COMPOSER_PLACEHOLDER
        }
        queueCount={queueCount}
        runtimeLabel={bottomDockMeta.runtimeLabel}
      />
    </Box>
  )
}
