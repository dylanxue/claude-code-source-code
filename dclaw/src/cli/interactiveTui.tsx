import React from 'react'
import { render } from 'ink'
import { TuiApp } from '../tui/App.js'
import type { UiEvent } from '../tui/state/index.js'
import { presentSlashCommandResult } from '../tui/presenters/slashCommandPresenter.js'
import { getCliErrorInfo } from './errorFormatting.js'
import { createInteractiveContext, getInteractiveRuntimeLabel } from './interactiveContext.js'
import { canStartInteractiveTui } from './interactiveUi.js'
import { runInteractiveSessionPrompt } from './interactiveSession.js'
import { maybeHandleSlashCommand } from './slashCommands.js'
import { ALL_PERMISSION_MODES } from './permissionModeConfig.js'
import type { InteractiveCommand } from './types.js'
import { createWelcomeCardData } from './welcome.js'
import { buildConfigAwareEnvWithSources } from './configFile.js'
import { loadResolvedLlmConfig } from '../llm/config.js'
import { listSessionHistory } from '../session/history.js'
import { loadExecutionTaskBoardForSession } from '../taskboard/store.js'
import { presentTaskBoardSnapshot } from '../tui/presenters/taskSnapshotPresenter.js'

const TUI_BACKGROUND_DRAIN_TIMEOUT_MS = 5_000

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

  const presentation = presentSlashCommandResult(prompt, result.outputText)
  presentation.events.forEach(onUiEvent)
  if (result.error !== undefined) {
    onUiEvent({
      type: 'system_notice',
      text: getCliErrorInfo(result.error).formattedText,
    })
  }

  return true
}

function shouldRefreshTaskSnapshotAfterLocalCommand(prompt: string): boolean {
  const [commandName] = prompt.trim().split(/\s+/u)
  return commandName === '/resume' || commandName === '/compact'
}

export async function runInteractiveTui(
  command: InteractiveCommand,
): Promise<void> {
  if (!canStartInteractiveTui()) {
    process.stdout.write('Interactive TUI requires a TTY.\n')
    return
  }

  const interactiveContext = await createInteractiveContext(command)
  const configured = await buildConfigAwareEnvWithSources(
    interactiveContext.interactiveOptions.cwd,
  )
  const llmConfig = await loadResolvedLlmConfig(
    interactiveContext.interactiveOptions.cwd,
    configured.env,
  )
  const welcomeCard = createWelcomeCardData({
    version: interactiveContext.version,
    runtimeLabel:
      interactiveContext.runtime.runtimeName ??
      interactiveContext.runtime.model ??
      interactiveContext.runtime.provider,
    cwd: interactiveContext.interactiveOptions.cwd,
  })

  const app = render(
    <TuiApp
      getBottomDockMeta={() => ({
        cwd: interactiveContext.interactiveOptions.cwd,
        permissionLabel: interactiveContext.interactiveSession.permissionMode,
        runtimeLabel: getInteractiveRuntimeLabel(interactiveContext),
      })}
      getBottomSheetOptions={() => {
        const runtimeNames = Object.keys(llmConfig.runtimes).sort((left, right) =>
          left.localeCompare(right),
        )

        return {
          '/permissions': ALL_PERMISSION_MODES.map(mode => ({
            value: mode,
            label: mode,
            description:
              mode === interactiveContext.interactiveSession.permissionMode
                ? 'Current mode'
                : undefined,
          })),
          '/runtime': [
            ...runtimeNames.map(name => ({
              value: name,
              label: name,
              description:
                name === interactiveContext.interactiveOptions.runtime
                  ? 'Current runtime'
                  : undefined,
            })),
            {
              value: 'list',
              label: 'list',
              description: 'Show available runtimes without switching.',
            },
          ],
          '/plan': [
            {
              value: 'enter',
              label: 'enter',
              description: 'Enter plan mode.',
            },
            {
              value: 'exit',
              label: 'exit',
              description: 'Exit plan mode without approval flow.',
            },
            {
              value: 'show',
              label: 'show',
              description: 'Show the current plan file status.',
            },
          ],
        }
      }}
      initialPrompt={command.prompt}
      welcomeCard={welcomeCard}
      onListResumeSessions={() => listSessionHistory(command.options.cwd)}
      onListSkillStatuses={() => {
        if (!interactiveContext.slashCommandContext.listSkillStatuses) {
          throw new Error('Skills are not available in this interactive context.')
        }

        return interactiveContext.slashCommandContext.listSkillStatuses()
      }}
      onLocalCommand={async (prompt, options) => {
        const result = await captureCommandResult(async writeOutput =>
          maybeHandleSlashCommand(prompt, interactiveContext.slashCommandContext, {
            allowDuringActivePrompt: options.allowDuringActivePrompt,
            writeOutput,
          }),
        )
        const handled = emitLocalCommandResult(prompt, result, options.onUiEvent)
        if (handled && shouldRefreshTaskSnapshotAfterLocalCommand(prompt)) {
          const board = await loadExecutionTaskBoardForSession(
            interactiveContext.interactiveSession.sessionId,
          )
          if (board) {
            options.onUiEvent({
              type: 'task_board_updated',
              snapshot: presentTaskBoardSnapshot(board),
            })
          }
        }

        return handled
      }}
      onPrompt={async (prompt, options) => {
        interactiveContext.slashCommandContext.engine.setAskUserQuestions(
          options.askUserQuestions,
        )
        const result = await runInteractiveSessionPrompt({
          engine: interactiveContext.slashCommandContext.engine,
          sessionId: interactiveContext.interactiveSession.sessionId,
          prompt,
          stream: interactiveContext.interactiveOptions.stream,
          signal: options.signal,
          env: interactiveContext.env,
          writeOutput() {},
          flushOutput() {},
          onUiEvent: options.onUiEvent,
        })
        interactiveContext.interactiveSession.sessionId = result.sessionId
        const runtimePermissionMode =
          interactiveContext.slashCommandContext.engine.getPermissionMode()
        if (runtimePermissionMode !== interactiveContext.interactiveSession.permissionMode) {
          interactiveContext.interactiveSession.permissionMode = runtimePermissionMode
          interactiveContext.interactiveSession.permissionModeSource = 'tool_runtime'
        }
      }}
      onSetSkillEnabled={(skillName, enabled) => {
        if (!interactiveContext.slashCommandContext.setSkillEnabled) {
          throw new Error(
            'Skill enablement changes are not available in this interactive context.',
          )
        }

        return interactiveContext.slashCommandContext.setSkillEnabled(skillName, enabled)
      }}
    />,
    {
      exitOnCtrlC: true,
    },
  )

  try {
    await app.waitUntilExit()
  } finally {
    app.cleanup()
    await interactiveContext.drainBackgroundWork(TUI_BACKGROUND_DRAIN_TIMEOUT_MS)
  }
}
