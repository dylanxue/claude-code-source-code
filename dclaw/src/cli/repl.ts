import { clearLine, cursorTo } from 'node:readline'
import { createInterface } from 'node:readline/promises'
import { registerInteractiveQuestionHost } from './interactiveQuestionHost.js'

export type ReplPromptControl = {
  signal: AbortSignal
  writeOutput: (text: string) => void
  flushOutput: () => void
}

export type ReplBusyPromptContext = {
  activePrompt: string
  pendingCount: number
  interruptActivePrompt: () => void
  writeOutput: (text: string) => void
  flushOutput: () => void
}

export type ReplLoopOptions = {
  initialPrompt?: string
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  promptText?: string
  busyPromptText?: string
  onImmediatePrompt?: (
    prompt: string,
    control: ReplPromptControl,
  ) => Promise<boolean> | boolean
  onPrompt: (prompt: string, control: ReplPromptControl) => Promise<void>
  onBusyPrompt?: (
    prompt: string,
    context: ReplBusyPromptContext,
  ) => Promise<boolean> | boolean
  onPromptQueued?: (
    prompt: string,
    pendingCount: number,
    writeOutput: (text: string) => void,
  ) => void
  onPromptInterrupted?: (
    prompt: string,
    writeOutput: (text: string) => void,
  ) => void
  onPromptError?: (error: unknown) => Promise<void> | void
}

const EXIT_COMMANDS = new Set([
  '/exit',
  'exit',
  'quit',
  '/quit',
  '.exit',
  '.quit',
])

function trimPrompt(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export function canStartInteractiveRepl(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): boolean {
  return Boolean(
    (input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY &&
      (output as NodeJS.WritableStream & { isTTY?: boolean }).isTTY,
  )
}

export async function runInteractiveReplLoop(
  options: ReplLoopOptions,
): Promise<void> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const promptText = options.promptText ?? 'dclaw> '
  const busyPromptText = options.busyPromptText ?? 'dclaw[busy]> '
  const initialPrompt = trimPrompt(options.initialPrompt)
  const interactive = canStartInteractiveRepl(input, output)
  const directWriteOutput = (text: string): void => {
    output.write(text)
  }

  const runPrompt = async (
    prompt: string,
    control: ReplPromptControl,
  ): Promise<void> => {
    try {
      await options.onPrompt(prompt, control)
    } catch (error) {
      if (!interactive || !options.onPromptError) {
        throw error
      }

      await options.onPromptError(error)
    }
  }

  if (initialPrompt && !interactive) {
    await runPrompt(initialPrompt, {
      signal: new AbortController().signal,
      writeOutput: directWriteOutput,
      flushOutput() {},
    })
  }

  if (!interactive) {
    return
  }

  output.write('REPL ready. Type /exit to quit.\n')

  const rl = createInterface({
    input,
    output,
    terminal: true,
  })
  const unregisterQuestionHost = registerInteractiveQuestionHost({
    question(prompt: string) {
      return rl.question(prompt)
    },
  })
  const isClosed = (): boolean =>
    (rl as typeof rl & { closed?: boolean }).closed === true

  let activePrompt: string | undefined
  let activeController: AbortController | undefined
  let activePromise: Promise<void> | undefined
  let closeRequested = false
  let bufferedOutput = ''
  const pendingPrompts: string[] = []

  const hasActivePrompt = (): boolean => Boolean(activePromise)

  const interruptActivePrompt = (): void => {
    if (!activeController || activeController.signal.aborted) {
      return
    }

    activeController.abort()
  }

  const isAbortLikeError = (error: unknown): boolean => {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'QueryLoopAbortError')
    )
  }

  const getPromptText = (): string => {
    if (!hasActivePrompt()) {
      return promptText
    }

    if (pendingPrompts.length === 0) {
      return busyPromptText
    }

    return busyPromptText.replace(/> $/u, ` +${pendingPrompts.length}> `)
  }

  const redrawPrompt = (): void => {
    if (isClosed() || closeRequested) {
      return
    }

    rl.setPrompt(getPromptText())
    rl.prompt(true)
  }

  const promptIfIdle = (): void => {
    if (!isClosed() && !hasActivePrompt() && !closeRequested) {
      redrawPrompt()
    }
  }

  const writeCompleteOutput = (text: string): void => {
    if (text.length === 0) {
      return
    }

    if (!isClosed()) {
      clearLine(output, 0)
      cursorTo(output, 0)
    }
    output.write(text)
    redrawPrompt()
  }

  const writeOutput = (text: string): void => {
    if (text.length === 0) {
      return
    }

    bufferedOutput += text
    let newlineIndex = bufferedOutput.indexOf('\n')
    while (newlineIndex >= 0) {
      const complete = bufferedOutput.slice(0, newlineIndex + 1)
      bufferedOutput = bufferedOutput.slice(newlineIndex + 1)
      writeCompleteOutput(complete)
      newlineIndex = bufferedOutput.indexOf('\n')
    }
  }

  const flushOutput = (): void => {
    if (bufferedOutput.length === 0) {
      return
    }

    const complete = bufferedOutput.endsWith('\n')
      ? bufferedOutput
      : `${bufferedOutput}\n`
    bufferedOutput = ''
    writeCompleteOutput(complete)
  }

  const startPrompt = (prompt: string): void => {
    const controller = new AbortController()
    activePrompt = prompt
    activeController = controller
    activePromise = (async () => {
      try {
        await runPrompt(prompt, {
          signal: controller.signal,
          writeOutput,
          flushOutput,
        })
      } catch (error) {
        if (!controller.signal.aborted || !isAbortLikeError(error)) {
          throw error
        }
      } finally {
        flushOutput()
        const interrupted = controller.signal.aborted
        activePrompt = undefined
        activeController = undefined
        activePromise = undefined
        if (interrupted) {
          options.onPromptInterrupted?.(prompt, writeOutput)
        }

        if (closeRequested) {
          return
        }

        const nextPrompt = pendingPrompts.shift()
        if (nextPrompt) {
          startPrompt(nextPrompt)
          redrawPrompt()
          return
        }

        promptIfIdle()
      }
    })()
  }

  const waitForActivePrompt = async (): Promise<void> => {
    const running = activePromise
    if (running) {
      await running
    }
  }

  rl.on('SIGINT', () => {
    if (hasActivePrompt()) {
      interruptActivePrompt()
      writeOutput('\nInterrupted current response.\n')
      return
    }

    closeRequested = true
    rl.close()
  })

  try {
    if (initialPrompt) {
      startPrompt(initialPrompt)
      redrawPrompt()
    } else {
      redrawPrompt()
    }

    for await (const line of rl) {
      const trimmed = trimPrompt(line)
      if (!trimmed) {
        promptIfIdle()
        continue
      }

      if (EXIT_COMMANDS.has(trimmed.toLowerCase())) {
        closeRequested = true
        pendingPrompts.splice(0, pendingPrompts.length)
        interruptActivePrompt()
        break
      }

      if (hasActivePrompt()) {
        const active = activePrompt ?? '<active prompt>'
        const handled = await options.onBusyPrompt?.(trimmed, {
          activePrompt: active,
          pendingCount: pendingPrompts.length,
          interruptActivePrompt,
          writeOutput,
          flushOutput,
        })
        if (handled) {
          flushOutput()
          continue
        }

        pendingPrompts.push(trimmed)
        options.onPromptQueued?.(trimmed, pendingPrompts.length, writeOutput)
        redrawPrompt()
        continue
      }

      const immediateHandled = await options.onImmediatePrompt?.(trimmed, {
        signal: new AbortController().signal,
        writeOutput,
        flushOutput,
      })
      if (immediateHandled) {
        flushOutput()
        promptIfIdle()
        continue
      }

      startPrompt(trimmed)
      redrawPrompt()
    }

    closeRequested = true
    interruptActivePrompt()
    flushOutput()
    await waitForActivePrompt()
  } finally {
    closeRequested = true
    unregisterQuestionHost()
    rl.close()
  }
}
