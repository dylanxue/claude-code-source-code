import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getPlanFilePath } from '../session/paths.js'
import type { TaskBoard } from './types.js'

function getDefaultPlanFileIdForBoard(boardId: string): string {
  return `plan_${boardId}`
}

function buildPlanScaffold(board: TaskBoard): string {
  return [
    `# ${board.title ?? 'Task Board Plan'}`,
    '',
    '## Context',
    `- workspace: ${board.workspaceId}`,
    `- task board: ${board.boardId}`,
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
  env: NodeJS.ProcessEnv = process.env,
): string {
  return getPlanFilePath(getDefaultPlanFileIdForBoard(boardId), env)
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

export async function ensurePlanFileForTaskBoard(
  board: TaskBoard,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  created: boolean
  filePath: string
}> {
  const filePath =
    board.planFilePath ??
    getPlanFilePath(getDefaultPlanFileIdForBoard(board.boardId), env)
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
