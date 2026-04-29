import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getProjectQueryTracesDir } from '../session/paths.js'

export type QueryTraceEvent = {
  timestamp: string
  sessionId?: string
  event: string
  iteration?: number
  data?: Record<string, unknown>
}

export type QueryTraceSink = {
  filePath?: string
  record(event: Omit<QueryTraceEvent, 'timestamp'>): void
  flush(): Promise<void>
}

function normalizeBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function shouldEnableQueryTrace(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return normalizeBooleanEnv(env.DCLAW_QUERY_TRACE)
}

export function createQueryTraceFilePath(
  env: NodeJS.ProcessEnv = process.env,
  sessionId?: string,
  workspaceRoot: string = env.DCLAW_WORKSPACE_ROOT ?? process.cwd(),
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const sessionLabel =
    typeof sessionId === 'string' && sessionId.trim().length > 0
      ? `${sessionId.trim()}-`
      : ''
  return join(
    getProjectQueryTracesDir(workspaceRoot, env),
    `${stamp}-${sessionLabel}${randomUUID()}.jsonl`,
  )
}

export async function createFileQueryTraceSink(
  filePath: string,
  sessionId?: string,
): Promise<QueryTraceSink> {
  await mkdir(dirname(filePath), { recursive: true })

  let pending = Promise.resolve()

  return {
    filePath,
    record(event) {
      const line =
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ...(sessionId ? { sessionId } : {}),
          ...event,
        }) + '\n'

      pending = pending
        .then(() => appendFile(filePath, line, 'utf8'))
        .catch(() => undefined)
    },
    async flush() {
      await pending.catch(() => undefined)
    },
  }
}
