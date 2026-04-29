import { createTextMessage, getTextContent, type Message } from '../types/message.js'
import { isFreshlyCompactedSession } from '../compact/boundaryMessage.js'
import { updateSessionPlanMode, type PlanModeState } from '../session/store.js'
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
  planMode: PlanModeState,
  reminderType: 'full' | 'sparse',
): string {
  if (reminderType === 'sparse') {
    return [
      '## Plan Mode',
      `You are still in plan mode. Keep planning in ${planMode.planFilePath ?? 'the active plan file'}.`,
      'Do not start implementation yet.',
      'Do not create or update tasks while planning. A task list belongs to the execution phase and should only be created when you are ready to begin implementation immediately.',
      'Only read-only tools and edits to the plan file are allowed.',
      "Write the plan file in the same language as the user's latest planning request unless the user asks for another language.",
      'Explore the codebase, interview the user when needed, and keep refining the plan file.',
      'When the plan is ready, call ExitPlanMode to request the user confirmation flow.',
    ].join('\n')
  }

  return [
    '## Plan Mode',
    `You are in plan mode. The plan file is ${planMode.planFilePath ?? 'the active plan file'}.`,
    '',
    'Before implementation, you should:',
    '1. Explore the codebase with read-only tools',
    '2. Clarify ambiguities or open questions',
    '3. Write or refine the plan in the plan file',
    '4. Stay in planning until the plan is ready to present to the user',
    '',
    'Important constraints:',
    '- Do not start implementation yet',
    '- The plan file is the only file you may edit while plan mode remains active',
    "- Write the plan file in the same language as the user's latest planning request unless the user asks for another language",
    '- Do not create or update tasks while planning; task tracking begins only when execution starts',
    '- When the plan is ready, call ExitPlanMode to request the user confirmation flow',
    '- Only a user confirmation choice may leave plan mode or start implementation',
  ].join('\n')
}

function buildPlanModeReentryText(planMode: PlanModeState): string {
  return [
    '## Re-entering Plan Mode',
    '',
    `You are returning to plan mode after previously exiting it. A plan file exists at ${planMode.planFilePath ?? 'the active plan file'}.`,
    '',
    'Before proceeding:',
    '1. Read the existing plan file',
    '2. Compare the current user request to that plan',
    '3. Decide whether to continue or overwrite it',
    "4. Update the plan file in the same language as the user's latest planning request before calling ExitPlanMode again",
    '',
    'Stay in planning while you do this. Do not create or update tasks until execution begins.',
    'Treat this as a fresh planning session. Do not assume the existing plan is still correct without checking.',
  ].join('\n')
}

function buildPlanModeExitText(planMode: PlanModeState): string {
  const planReference = planMode.planFilePath
    ? ` The plan file remains at ${planMode.planFilePath} if you need to reference it.`
    : ''

  return [
    '## Exited Plan Mode',
    '',
    `You have exited plan mode.${planReference}`,
    'Present the plan to the user now. Do not start implementation, create tasks, or begin task tracking until the user asks you to proceed or gives follow-up changes.',
  ].join('\n')
}

function wrapSystemReminder(text: string): Message {
  return createTextMessage('user', `<system-reminder>\n${text}\n</system-reminder>`)
}

export function createPostCompactPlanModeReminderMessage(
  messages: Message[],
  planMode: PlanModeState | null | undefined,
  permissionMode: PermissionMode,
): Message | null {
  if (
    permissionMode !== 'plan' ||
    !planMode ||
    planMode.status !== 'active' ||
    !isFreshlyCompactedSession(messages)
  ) {
    return null
  }

  return wrapSystemReminder(buildPlanModeReminderText(planMode, 'full'))
}

function shouldAttachPlanModeReminder(
  planMode: PlanModeState,
  currentHumanTurnCount: number,
): boolean {
  const last = planMode.lastReminderTurnCount
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
  planMode: PlanModeState | null | undefined,
  permissionMode: PermissionMode,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Message[]> {
  if (!planMode) {
    return []
  }

  if (permissionMode !== 'plan') {
    if (!planMode.needsExitReminder) {
      return []
    }

    await updateSessionPlanMode(
      sessionId,
      current => ({
        ...(current ?? planMode),
        needsExitReminder: false,
      }),
      env,
    )

    return [wrapSystemReminder(buildPlanModeExitText(planMode))]
  }

  if (planMode.status !== 'active') {
    return []
  }

  const currentHumanTurnCount = countHumanTurns(messages) + 1
  if (!shouldAttachPlanModeReminder(planMode, currentHumanTurnCount)) {
    return []
  }

  const nextReminderCount = (planMode.reminderCount ?? 0) + 1
  const reminderType: 'full' | 'sparse' =
    nextReminderCount % PLAN_MODE_FULL_REMINDER_EVERY_N_ATTACHMENTS === 1
      ? 'full'
      : 'sparse'

  await updateSessionPlanMode(
    sessionId,
    current => ({
      ...(current ?? planMode),
      reminderCount: nextReminderCount,
      lastReminderTurnCount: currentHumanTurnCount,
      hasExitedInSession: false,
    }),
    env,
  )

  const reminderMessages: Message[] = []
  if (planMode.hasExitedInSession) {
    reminderMessages.push(wrapSystemReminder(buildPlanModeReentryText(planMode)))
  }
  reminderMessages.push(
    wrapSystemReminder(buildPlanModeReminderText(planMode, reminderType)),
  )
  return reminderMessages
}
