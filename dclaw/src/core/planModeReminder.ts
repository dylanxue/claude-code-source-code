import { createTextMessage, getTextContent, type Message } from '../types/message.js'
import { isFreshlyCompactedSession } from '../compact/boundaryMessage.js'
import { updateTaskBoard } from '../tasks/store.js'
import { getCurrentTask } from '../tasks/taskState.js'
import type { TaskBoard } from '../tasks/types.js'
import type { PermissionMode } from '../types/tool.js'

const PLAN_MODE_TURNS_BETWEEN_ATTACHMENTS = 5
const PLAN_MODE_FULL_REMINDER_EVERY_N_ATTACHMENTS = 5

function isSystemReminderMessage(message: Message): boolean {
  return (
    message.role === 'user' &&
    getTextContent(message).startsWith('<system-reminder>')
  )
}

function countHumanTurns(messages: Message[]): number {
  return messages.filter(
    message => message.role === 'user' && !isSystemReminderMessage(message),
  ).length
}

function buildPlanModeReminderText(
  board: TaskBoard,
  reminderType: 'full' | 'sparse',
): string {
  const currentTask = getCurrentTask(board)
  const taskContextLines = [
    ...(currentTask ? [`Current task: ${currentTask.subject}`] : []),
    ...(board.currentStep ? [`Current step: ${board.currentStep}`] : []),
  ]

  if (reminderType === 'sparse') {
    return [
      '## Plan Mode',
      `You are still in plan mode. Keep planning in ${board.planFilePath ?? 'the active plan file'}.`,
      ...taskContextLines,
      'Do not start implementation yet.',
      'Only read-only tools and edits to the plan file are allowed.',
      'When the plan is ready, call ExitPlanMode.',
    ].join('\n')
  }

  return [
    '## Plan Mode',
    `You are in plan mode. The plan file is ${board.planFilePath ?? 'the active plan file'}.`,
    ...taskContextLines,
    '',
    'Before implementation, you should:',
    '1. Explore the codebase with read-only tools',
    '2. Clarify ambiguities or open questions',
    '3. Write or refine the plan in the plan file',
    '4. Stay in planning until the plan is ready for approval',
    '',
    'Important constraints:',
    '- Do not start implementation yet',
    '- The plan file is the only file you may edit while plan mode remains active',
    '- When the plan is ready, call ExitPlanMode to request approval',
  ].join('\n')
}

function buildPlanModeReentryText(board: TaskBoard): string {
  return [
    '## Re-entering Plan Mode',
    '',
    `You are returning to plan mode after previously exiting it. A plan file exists at ${board.planFilePath ?? 'the active plan file'}.`,
    '',
    'Before proceeding:',
    '1. Read the existing plan file',
    '2. Compare the current user request to that plan',
    '3. Decide whether to continue or overwrite it',
    '4. Update the plan file before calling ExitPlanMode again',
    '',
    'Treat this as a fresh planning session. Do not assume the existing plan is still correct without checking.',
  ].join('\n')
}

function buildPlanModeExitText(board: TaskBoard): string {
  const planReference = board.planFilePath
    ? ` The plan file remains at ${board.planFilePath} if you need to reference it.`
    : ''

  return [
    '## Exited Plan Mode',
    '',
    `You have exited plan mode. You can now make edits, run tools, and take implementation actions.${planReference}`,
  ].join('\n')
}

function wrapSystemReminder(text: string): Message {
  return createTextMessage('user', `<system-reminder>\n${text}\n</system-reminder>`)
}

export function createPostCompactPlanModeReminderMessage(
  messages: Message[],
  board: TaskBoard | null | undefined,
  permissionMode: PermissionMode,
): Message | null {
  if (
    permissionMode !== 'plan' ||
    !board ||
    board.mode !== 'active' ||
    !isFreshlyCompactedSession(messages)
  ) {
    return null
  }

  return wrapSystemReminder(buildPlanModeReminderText(board, 'full'))
}

function shouldAttachPlanModeReminder(
  board: TaskBoard,
  currentHumanTurnCount: number,
): boolean {
  const last = board.lastPlanModeReminderTurnCount
  if (last === undefined) {
    return true
  }

  if (currentHumanTurnCount < last) {
    return true
  }

  return currentHumanTurnCount - last >= PLAN_MODE_TURNS_BETWEEN_ATTACHMENTS
}

export async function createPlanModeReminderMessages(
  messages: Message[],
  board: TaskBoard | null | undefined,
  permissionMode: PermissionMode,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Message[]> {
  if (!board) {
    return []
  }

  if (permissionMode !== 'plan') {
    if (!board.needsPlanModeExitReminder) {
      return []
    }

    await updateTaskBoard(
      board.boardId,
      current => ({
        ...current,
        needsPlanModeExitReminder: false,
        latestSessionId: current.latestSessionId,
        updatedAt: new Date().toISOString(),
      }),
      env,
    )

    return [wrapSystemReminder(buildPlanModeExitText(board))]
  }

  if (board.mode !== 'active') {
    return []
  }

  const currentHumanTurnCount = countHumanTurns(messages) + 1
  if (!shouldAttachPlanModeReminder(board, currentHumanTurnCount)) {
    return []
  }

  const nextReminderCount = (board.planModeReminderCount ?? 0) + 1
  const reminderType: 'full' | 'sparse' =
    nextReminderCount % PLAN_MODE_FULL_REMINDER_EVERY_N_ATTACHMENTS === 1
      ? 'full'
      : 'sparse'

  await updateTaskBoard(
    board.boardId,
    current => ({
      ...current,
      planModeReminderCount: nextReminderCount,
      lastPlanModeReminderTurnCount: currentHumanTurnCount,
      hasExitedPlanModeInSession: false,
      updatedAt: new Date().toISOString(),
    }),
    env,
  )

  const reminderMessages: Message[] = []
  if (board.hasExitedPlanModeInSession) {
    reminderMessages.push(wrapSystemReminder(buildPlanModeReentryText(board)))
  }
  reminderMessages.push(
    wrapSystemReminder(buildPlanModeReminderText(board, reminderType)),
  )
  return reminderMessages
}
