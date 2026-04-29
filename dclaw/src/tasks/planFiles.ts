import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getPlanFilePath, getSessionDir } from '../session/paths.js'

type LegacyPlanBoardPlanFileInput = {
  boardId: string
  workspaceId: string
  rootSessionId: string
  planFilePath?: string
  title?: string
  purpose?: string
  background?: string
  plan?: string
  scope?: string
}

function getDefaultPlanFileIdForBoard(boardId: string): string {
  return `plan_${boardId}`
}

function getDefaultPlanFileIdForSession(sessionId: string): string {
  return `plan_${sessionId}`
}

function buildPlanScaffold(board: LegacyPlanBoardPlanFileInput): string {
  return [
    `# ${board.title ?? 'Plan Board Plan'}`,
    '',
    '## Context',
    `- workspace: ${board.workspaceId}`,
    `- plan board: ${board.boardId}`,
    `- root session: ${board.rootSessionId}`,
    ...(board.background ? [`- background: ${board.background}`] : []),
    '',
    '## Purpose',
    board.purpose ?? '- Describe the current short-lived work batch.',
    '',
    '## Scope',
    board.scope ?? '- Define what this board will and will not cover.',
    '',
    '## Approach',
    board.plan ?? '- Outline the implementation strategy for this board.',
    '',
    '## Files',
    '- List the key files that will need to change.',
    '',
    '## Verification',
    '- Describe how the changes should be validated.',
    '',
  ].join('\n')
}

export function getDefaultPlanFilePath(
  boardId: string,
  workspaceRootOrEnv: string | NodeJS.ProcessEnv = process.env,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return getPlanFilePath(getDefaultPlanFileIdForBoard(boardId), workspaceRootOrEnv, env)
}

export function getSessionPlanFilePath(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getSessionDir(sessionId, env), 'plan.md')
}

export async function readPlanFile(
  filePath: string,
): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function writePlanFile(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
}

export async function ensurePlanFileForPlanBoard(
  board: LegacyPlanBoardPlanFileInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  created: boolean
  filePath: string
}> {
  const filePath =
    board.planFilePath ??
    getPlanFilePath(getDefaultPlanFileIdForBoard(board.boardId), board.workspaceId, env)
  const existing = await readPlanFile(filePath)
  if (existing !== null) {
    return {
      created: false,
      filePath,
    }
  }

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, buildPlanScaffold(board), 'utf8')
  return {
    created: true,
    filePath,
  }
}
