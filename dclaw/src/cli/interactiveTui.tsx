import React from 'react'
import { render } from 'ink'
import { TuiApp } from '../tui/App.js'
import type { UiEvent } from '../tui/state/index.js'
import { presentReplCommandResult } from '../tui/presenters/replCommandPresenter.js'
import { getCliErrorInfo } from './errorFormatting.js'
import { createInteractiveContext, getInteractiveRuntimeLabel } from './interactiveContext.js'
import { canStartInteractiveTui } from './interactiveUi.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import { maybeHandleReplCommand } from './replCommands.js'
import type { InteractiveCommand } from './types.js'

type CapturedCommandResult = {
  handled: boolean
  outputText: string
  error?: unknown
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/gu, '')
}

function normalizeCapturedOutput(text: string): string {
  return stripAnsi(text)
    .replace(/\r\n/gu, '\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '')
}

async function captureCommandResult(
  runner: (writeOutput: (text: string) => void) => Promise<boolean>,
): Promise<CapturedCommandResult> {
  const bufferedOutput: string[] = []
  const writeOutput = (text: string): void => {
    bufferedOutput.push(text)
  }
  let handled = false
  let error: unknown

  try {
    handled = await runner(writeOutput)
  } catch (caughtError) {
    error = caughtError
  }

  return {
    handled,
    outputText: normalizeCapturedOutput(bufferedOutput.join('')),
    ...(error === undefined ? {} : { error }),
  }
}

function emitLocalCommandResult(
  prompt: string,
  result: CapturedCommandResult,
  onUiEvent: (event: UiEvent) => void,
): boolean {
  if (!result.handled && result.error === undefined) {
    return false
  }

  const presentation = presentReplCommandResult(prompt, result.outputText)
  presentation.events.forEach(onUiEvent)
  if (result.error !== undefined) {
    onUiEvent({
      type: 'system_notice',
      text: getCliErrorInfo(result.error).formattedText,
    })
  }

  return true
}

export async function runInteractiveTui(
  command: InteractiveCommand,
): Promise<void> {
  if (!canStartInteractiveTui()) {
    process.stdout.write('Interactive TUI requires a TTY.\n')
    return
  }

  const interactiveContext = await createInteractiveContext(command)

  const app = render(
    <TuiApp
      getBottomDockMeta={() => ({
        cwd: interactiveContext.replOptions.cwd,
        permissionLabel: interactiveContext.replSession.permissionMode,
        runtimeLabel: getInteractiveRuntimeLabel(interactiveContext),
      })}
      initialPrompt={command.prompt}
      onLocalCommand={async (prompt, options) => {
        const result = await captureCommandResult(async writeOutput =>
          maybeHandleReplCommand(prompt, interactiveContext.replContext, {
            allowDuringActivePrompt: options.allowDuringActivePrompt,
            writeOutput,
          }),
        )
        return emitLocalCommandResult(prompt, result, options.onUiEvent)
      }}
      onPrompt={async (prompt, options) => {
        const result = await runInteractiveSessionPrompt({
          engine: interactiveContext.replContext.engine,
          sessionId: interactiveContext.replSession.sessionId,
          prompt,
          stream: interactiveContext.replOptions.stream,
          verbose: false,
          signal: options.signal,
          writeOutput() {},
          flushOutput() {},
          onUiEvent: options.onUiEvent,
        })
        interactiveContext.replSession.sessionId = result.sessionId
        const runtimePermissionMode =
          interactiveContext.replContext.engine.getPermissionMode()
        if (runtimePermissionMode !== interactiveContext.replSession.permissionMode) {
          interactiveContext.replSession.permissionMode = runtimePermissionMode
          interactiveContext.replSession.permissionModeSource = 'tool_runtime'
        }
      }}
    />,
    {
      exitOnCtrlC: true,
    },
  )

  try {
    await app.waitUntilExit()
  } finally {
    await interactiveContext.drainBackgroundWork()
  }
}
