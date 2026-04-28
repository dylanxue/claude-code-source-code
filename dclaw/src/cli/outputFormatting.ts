import type {
  ContentBlock,
  Message,
  ToolUseContentBlock,
} from '../types/message.js'

export type AutoCompactNotice = {
  sessionId: string
  boundaryId: string
  reason: string
  summaryMessageId: string
}

function stringifyInline(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function truncateInlineText(value: string, maxLength: number = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`
}

function quoteInline(value: string): string {
  return `"${truncateInlineText(value, 80)}"`
}

function getInputPath(input: Record<string, unknown>): string | undefined {
  const filePath = input.file_path
  if (typeof filePath === 'string' && filePath.trim().length > 0) {
    return filePath.trim()
  }

  const path = input.path
  if (typeof path === 'string' && path.trim().length > 0) {
    return path.trim()
  }

  return undefined
}

function formatReadTarget(input: Record<string, unknown>): string | undefined {
  const filePath = getInputPath(input)
  if (!filePath) {
    return undefined
  }

  const offset = typeof input.offset === 'number' ? input.offset : undefined
  const limit = typeof input.limit === 'number' ? input.limit : undefined
  if (offset === undefined && limit === undefined) {
    return filePath
  }

  const startLine = offset ?? 1
  const endLine = limit === undefined ? undefined : startLine + limit - 1
  return endLine === undefined
    ? `${filePath}:${startLine}-`
    : `${filePath}:${startLine}-${endLine}`
}

function formatToolUseDetail(
  name: string,
  input: Record<string, unknown>,
): string | undefined {
  switch (name) {
    case 'Read':
      return formatReadTarget(input)
    case 'Edit':
    case 'Write':
      return getInputPath(input)
    case 'Bash': {
      const command =
        typeof input.command === 'string' ? truncateInlineText(input.command, 100) : ''
      if (!command) {
        return undefined
      }
      const executionMode = input.run_in_background === true ? ' [background]' : ''
      return `${command}${executionMode}`
    }
    case 'Glob': {
      const pattern =
        typeof input.pattern === 'string' ? quoteInline(input.pattern) : undefined
      const searchRoot = getInputPath(input)
      if (pattern && searchRoot) {
        return `${pattern} in ${searchRoot}`
      }
      return pattern ?? searchRoot
    }
    case 'Grep': {
      const pattern =
        typeof input.pattern === 'string' ? quoteInline(input.pattern) : undefined
      const searchRoot = getInputPath(input)
      if (pattern && searchRoot) {
        return `${pattern} in ${searchRoot}`
      }
      return pattern ?? searchRoot
    }
    case 'WebFetch': {
      const url = typeof input.url === 'string' ? input.url : undefined
      if (!url) {
        return undefined
      }
      const prompt =
        typeof input.prompt === 'string' && input.prompt.trim().length > 0
          ? ` for ${quoteInline(input.prompt)}`
          : ''
      return `${url}${prompt}`
    }
    case 'AskUserQuestion': {
      const questions = Array.isArray(input.questions) ? input.questions : []
      const count = questions.length
      if (count === 0) {
        return undefined
      }
      const first = asRecord(questions[0])
      const header =
        typeof first?.header === 'string' && first.header.trim().length > 0
          ? ` (${truncateInlineText(first.header, 40)})`
          : ''
      return `${count} question${count === 1 ? '' : 's'}${header}`
    }
    case 'TaskGet': {
      const taskId = typeof input.id === 'string' ? input.id : input.taskId
      return typeof taskId === 'string' ? `#${taskId}` : undefined
    }
    case 'TaskUpdate': {
      const taskId = typeof input.id === 'string' ? input.id : input.taskId
      const status = typeof input.status === 'string' ? ` [${input.status}]` : ''
      return typeof taskId === 'string' ? `#${taskId}${status}` : undefined
    }
    case 'TaskCreate':
      if (Array.isArray(input.tasks) && input.tasks.length > 0) {
        return `${input.tasks.length} tasks`
      }
      return typeof input.subject === 'string'
        ? truncateInlineText(input.subject, 80)
        : undefined
    case 'Skill':
      return typeof input.skill_name === 'string' &&
        input.skill_name.trim().length > 0
        ? input.skill_name.trim()
        : undefined
    case 'Agent': {
      const action = typeof input.action === 'string' ? input.action : undefined
      const agentId =
        typeof input.agent_id === 'string' && input.agent_id.trim().length > 0
          ? input.agent_id.trim()
          : undefined
      const task =
        typeof input.task === 'string' && input.task.trim().length > 0
          ? truncateInlineText(input.task, 80)
          : undefined
      const message =
        typeof input.message === 'string' && input.message.trim().length > 0
          ? truncateInlineText(input.message, 80)
          : undefined

      switch (action) {
        case 'spawn':
          if (agentId && task) {
            return `${agentId} for ${quoteInline(task)}`
          }
          return agentId ?? task
        case 'send':
          if (agentId && message) {
            return `${agentId} with ${quoteInline(message)}`
          }
          return agentId ?? message
        case 'wait':
        case 'stop':
          return agentId
        default:
          return agentId ?? task ?? message
      }
    }
    default:
      return undefined
  }
}

function formatToolUseText(toolUse: {
  name: string
  input: Record<string, unknown>
}): string {
  const detail = formatToolUseDetail(toolUse.name, toolUse.input)
  switch (toolUse.name) {
    case 'Read':
      return detail ? `Reading ${detail}` : 'Reading'
    case 'Edit':
      return detail ? `Editing ${detail}` : 'Editing'
    case 'Write':
      return detail ? `Writing ${detail}` : 'Writing'
    case 'Bash':
      return detail
        ? toolUse.input.run_in_background === true
          ? `Starting ${detail}`
          : `Running ${detail}`
        : 'Running command'
    case 'Glob':
      return detail ? `Searching files matching ${detail}` : 'Searching files'
    case 'Grep':
      return detail ? `Searching ${detail}` : 'Searching files'
    case 'WebFetch':
      return detail ? `Fetching ${detail}` : 'Fetching URL'
    case 'AskUserQuestion':
      return detail ? `Asking ${detail}` : 'Asking user question'
    case 'Skill':
      return detail ? `Applying skill ${detail}` : 'Applying skill'
    case 'TaskGet':
      return detail ? `Viewing task ${detail}` : 'Viewing task'
    case 'TaskUpdate':
      return detail ? `Updating task ${detail}` : 'Updating task'
    case 'TaskCreate':
      return detail ? `Creating task ${detail}` : 'Creating task'
    case 'Agent': {
      const action =
        typeof toolUse.input.action === 'string' ? toolUse.input.action : undefined
      switch (action) {
        case 'spawn':
          return detail
            ? `Starting subagent ${detail}`
            : 'Starting subagent'
        case 'send':
          return detail
            ? `Sending follow-up to subagent ${detail}`
            : 'Sending follow-up to subagent'
        case 'wait':
          return detail
            ? `Waiting for subagent ${detail}`
            : 'Waiting for subagent'
        case 'stop':
          return detail
            ? `Stopping subagent ${detail}`
            : 'Stopping subagent'
        default:
          return detail ? `Agent ${detail}` : 'Agent'
      }
    }
    default: {
      if (detail) {
        return `Calling ${toolUse.name} ${detail}`
      }

      const fallback = stringifyInline(toolUse.input)
      return fallback === '{}' ? `Calling ${toolUse.name}` : `Calling ${toolUse.name} ${fallback}`
    }
  }
}

function formatToolResultActionText(toolUse: {
  name: string
  input: Record<string, unknown>
}): string {
  const detail = formatToolUseDetail(toolUse.name, toolUse.input)
  switch (toolUse.name) {
    case 'Read':
      return detail ? `Read ${detail}` : 'Read'
    case 'Edit':
      return detail ? `Edit ${detail}` : 'Edit'
    case 'Write':
      return detail ? `Write ${detail}` : 'Write'
    case 'Bash':
      return detail
        ? toolUse.input.run_in_background === true
          ? `Started ${detail}`
          : `Ran ${detail}`
        : 'Ran command'
    case 'Glob':
      return detail ? `Searched files matching ${detail}` : 'Searched files'
    case 'Grep':
      return detail ? `Searched ${detail}` : 'Searched files'
    case 'WebFetch':
      return detail ? `Fetched ${detail}` : 'Fetched URL'
    case 'AskUserQuestion':
      return detail ? `Asked ${detail}` : 'Asked user question'
    case 'Skill':
      return detail ? `Applied skill ${detail}` : 'Applied skill'
    case 'TaskGet':
      return detail ? `Viewed task ${detail}` : 'Viewed task'
    case 'TaskUpdate':
      return detail ? `Updated task ${detail}` : 'Updated task'
    case 'TaskCreate':
      return detail ? `Created task ${detail}` : 'Created task'
    case 'Agent':
      return formatToolUseText(toolUse)
    default: {
      if (detail) {
        return `${toolUse.name} ${detail}`
      }

      const fallback = stringifyInline(toolUse.input)
      return fallback === '{}' ? toolUse.name : `${toolUse.name} ${fallback}`
    }
  }
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0)
}

function normalizeProgressAssistantText(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function countLogicalLines(value: string): number {
  if (value.length === 0) {
    return 0
  }

  const lines = value.split(/\r?\n/)
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

function formatReadPreview(output: Record<string, unknown>): string | undefined {
  const file = asRecord(output.file)
  if (!file) {
    return undefined
  }

  const startLine = typeof file.startLine === 'number' ? file.startLine : undefined
  const endLine = typeof file.endLine === 'number' ? file.endLine : undefined
  const totalLines = typeof file.totalLines === 'number' ? file.totalLines : undefined
  const content = typeof file.content === 'string' ? file.content : undefined
  const snippet = content ? firstNonEmptyLine(content) : undefined
  const range =
    startLine !== undefined && endLine !== undefined && totalLines !== undefined
      ? `lines ${startLine}-${endLine} of ${totalLines}`
      : undefined

  if (range && snippet) {
    return `${range}; starts with ${quoteInline(snippet)}`
  }
  return range ?? (snippet ? truncateInlineText(snippet) : undefined)
}

function formatBashPreview(output: Record<string, unknown>): string | undefined {
  const persistedOutputPath =
    typeof output.persistedOutputPath === 'string' ? output.persistedOutputPath : undefined
  if (persistedOutputPath) {
    return `output saved to ${persistedOutputPath}`
  }

  const stdout = typeof output.stdout === 'string' ? firstNonEmptyLine(output.stdout) : undefined
  const stderr = typeof output.stderr === 'string' ? firstNonEmptyLine(output.stderr) : undefined
  const snippet = stdout ?? stderr
  const exitCode = typeof output.exitCode === 'number' ? output.exitCode : undefined
  const interrupted = output.interrupted === true ? ' interrupted' : ''

  if (snippet && exitCode !== undefined) {
    return `exit ${exitCode}${interrupted}; ${truncateInlineText(snippet)}`
  }
  if (snippet) {
    return truncateInlineText(snippet)
  }
  if (exitCode !== undefined) {
    return `exit ${exitCode}${interrupted}`
  }
  return undefined
}

function formatEditPreview(output: Record<string, unknown>): string | undefined {
  const replaced = typeof output.replaced === 'number' ? output.replaced : undefined
  const content = typeof output.content === 'string' ? output.content : undefined
  const snippet = content ? firstNonEmptyLine(content) : undefined

  if (replaced !== undefined && snippet) {
    return `updated ${replaced} occurrence${replaced === 1 ? '' : 's'}; now starts with ${quoteInline(snippet)}`
  }
  if (replaced !== undefined) {
    return `updated ${replaced} occurrence${replaced === 1 ? '' : 's'}`
  }
  return snippet ? `now starts with ${quoteInline(snippet)}` : undefined
}

function formatWritePreview(output: Record<string, unknown>): string | undefined {
  const type = typeof output.type === 'string' ? output.type : undefined
  const content = typeof output.content === 'string' ? output.content : undefined
  const lineCount = content !== undefined ? countLogicalLines(content) : undefined

  switch (type) {
    case 'create':
      return lineCount !== undefined
        ? `created file with ${lineCount} line${lineCount === 1 ? '' : 's'}`
        : 'created file'
    case 'update':
      return lineCount !== undefined
        ? `updated file to ${lineCount} line${lineCount === 1 ? '' : 's'}`
        : 'updated file'
    case 'noop':
      return 'no changes'
    default:
      return undefined
  }
}

function formatFileListPreview(output: Record<string, unknown>): string | undefined {
  const filenames = Array.isArray(output.filenames)
    ? output.filenames.filter((value): value is string => typeof value === 'string')
    : []
  if (filenames.length === 0) {
    return undefined
  }

  const totalFiles =
    typeof output.totalFiles === 'number'
      ? output.totalFiles
      : typeof output.numFiles === 'number'
        ? output.numFiles
        : filenames.length
  const preview = filenames.slice(0, 3).join(', ')
  return totalFiles > filenames.length
    ? `${filenames.length} of ${totalFiles} files: ${truncateInlineText(preview)}`
    : `${totalFiles} files: ${truncateInlineText(preview)}`
}

function formatSearchPreview(output: Record<string, unknown>): string | undefined {
  const numFiles = typeof output.numFiles === 'number' ? output.numFiles : undefined
  const totalMatches =
    typeof output.totalMatches === 'number'
      ? output.totalMatches
      : typeof output.numMatches === 'number'
        ? output.numMatches
        : typeof output.numLines === 'number'
          ? output.numLines
          : undefined
  const content = typeof output.content === 'string' ? firstNonEmptyLine(output.content) : undefined

  const counts =
    numFiles !== undefined && totalMatches !== undefined
      ? `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${numFiles} file${numFiles === 1 ? '' : 's'}`
      : totalMatches !== undefined
        ? `${totalMatches} match${totalMatches === 1 ? '' : 'es'}`
        : numFiles !== undefined
          ? `${numFiles} file${numFiles === 1 ? '' : 's'}`
          : undefined

  if (counts && content) {
    return `${counts}; first hit: ${quoteInline(content)}`
  }
  return counts ?? (content ? truncateInlineText(content) : undefined)
}

function extractWebFetchExcerpt(result: string): string | undefined {
  const lines = result
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)

  const headingIndex = lines.findIndex(
    line =>
      line === 'Relevant excerpts for the prompt:' ||
      line === 'Leading excerpt from the page:',
  )
  if (headingIndex !== -1) {
    const excerpt = lines[headingIndex + 1]
    if (excerpt && !excerpt.startsWith('[')) {
      return excerpt
    }
  }

  for (const line of lines) {
    if (
      line.startsWith('Prompt:') ||
      line.startsWith('Fetched from:') ||
      line.startsWith('Status:') ||
      line.startsWith('Content-Type:') ||
      line.startsWith('Title:') ||
      line.startsWith('Description:')
    ) {
      continue
    }
    if (line.startsWith('REDIRECT DETECTED:')) {
      return line
    }
    return line
  }

  return undefined
}

function formatWebFetchPreview(output: Record<string, unknown>): string | undefined {
  const title = typeof output.title === 'string' ? output.title : undefined
  const excerpt =
    typeof output.result === 'string' ? extractWebFetchExcerpt(output.result) : undefined
  if (title && excerpt) {
    return `${truncateInlineText(title, 60)}; ${truncateInlineText(excerpt)}`
  }
  return title ?? (excerpt ? truncateInlineText(excerpt) : undefined)
}

function formatQuestionPreview(output: Record<string, unknown>): string | undefined {
  const answers = asRecord(output.answers)
  if (!answers) {
    return undefined
  }

  const entries = Object.entries(answers)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 2)
    .map(([key, value]) => `${key}=${truncateInlineText(String(value), 40)}`)
  if (entries.length === 0) {
    return undefined
  }
  return `answered: ${entries.join(', ')}`
}

function formatPersistedToolResultPreview(output: Record<string, unknown>): string | undefined {
  if (output.type !== 'persisted_tool_result') {
    return undefined
  }

  const filepath = typeof output.filepath === 'string' ? output.filepath : undefined
  const preview = typeof output.preview === 'string' ? firstNonEmptyLine(output.preview) : undefined
  if (filepath && preview) {
    return `saved to ${filepath}; ${truncateInlineText(preview)}`
  }
  if (filepath) {
    return `saved to ${filepath}`
  }
  return preview ? truncateInlineText(preview) : undefined
}

function formatAgentPreview(output: Record<string, unknown>): string | undefined {
  const agent = asRecord(output.agent)
  const result = asRecord(output.result)
  const status =
    typeof agent?.status === 'string' && agent.status.trim().length > 0
      ? agent.status.trim()
      : undefined
  const summary =
    typeof result?.summary === 'string' && result.summary.trim().length > 0
      ? result.summary.trim()
      : undefined
  const outputText =
    typeof result?.output_text === 'string' && result.output_text.trim().length > 0
      ? firstNonEmptyLine(result.output_text)
      : undefined
  const error =
    typeof result?.error === 'string' && result.error.trim().length > 0
      ? result.error.trim()
      : undefined

  const detail = error ?? summary ?? outputText
  if (status && detail) {
    return `${status}; ${truncateInlineText(detail)}`
  }
  if (detail) {
    return truncateInlineText(detail)
  }
  return status
}

function formatAgentResultLine(
  toolUse: ToolUseSummary | undefined,
  output: unknown,
): string | undefined {
  const { payload } = getToolResultPayload(output)
  const record = asRecord(payload)
  if (!record) {
    return undefined
  }

  const agent = asRecord(record.agent)
  if (!agent) {
    return undefined
  }

  const agentId =
    typeof agent.agent_id === 'string' && agent.agent_id.trim().length > 0
      ? agent.agent_id.trim()
      : typeof toolUse?.input.agent_id === 'string' &&
          toolUse.input.agent_id.trim().length > 0
        ? toolUse.input.agent_id.trim()
        : 'unknown'
  const status =
    typeof agent.status === 'string' && agent.status.trim().length > 0
      ? agent.status.trim()
      : 'updated'
  const preview = formatAgentPreview(record)
  const detail =
    preview && preview !== status
      ? preview.startsWith(`${status}; `)
        ? preview.slice(status.length + 2)
        : preview
      : undefined

  return detail
    ? `Subagent ${agentId} ${status} (${detail})`
    : `Subagent ${agentId} ${status}`
}

function getToolResultPayload(output: unknown): {
  summary?: string
  error?: string
  payload: unknown
} {
  const record = asRecord(output)
  if (!record) {
    return { payload: output }
  }

  const summary =
    typeof record.summary === 'string' && record.summary.trim().length > 0
      ? record.summary.trim()
      : undefined
  const error =
    typeof record.error === 'string' && record.error.trim().length > 0
      ? record.error.trim()
      : undefined
  const payload = 'output' in record ? record.output : output
  return { summary, error, payload }
}

type ToolUseSummary = {
  name: string
  input: Record<string, unknown>
}

function getToolResultPreview(
  toolName: string | undefined,
  output: unknown,
): string | undefined {
  const { payload } = getToolResultPayload(output)
  const record = asRecord(payload)
  if (!record) {
    return typeof payload === 'string' ? truncateInlineText(payload) : undefined
  }

  return (
    formatPersistedToolResultPreview(record) ??
    (toolName === 'Agent' ? formatAgentPreview(record) : undefined) ??
    (toolName === 'Skill' ? formatSkillPreview(record) : undefined) ??
    formatReadPreview(record) ??
    formatBashPreview(record) ??
    (toolName === 'Edit' ? formatEditPreview(record) : undefined) ??
    (toolName === 'Write' ? formatWritePreview(record) : undefined) ??
    (toolName === 'Glob' ? formatFileListPreview(record) : undefined) ??
    (toolName === 'Grep' ? formatSearchPreview(record) : undefined) ??
    formatWebFetchPreview(record) ??
    formatQuestionPreview(record) ??
    (typeof record.content === 'string'
      ? truncateInlineText(firstNonEmptyLine(record.content) ?? record.content)
      : undefined)
  )
}

function formatSkillPreview(record: Record<string, unknown>): string | undefined {
  const skill = asRecord(record.skill)
  if (!skill) {
    return undefined
  }

  const source =
    typeof skill.source === 'string' && skill.source.trim().length > 0
      ? skill.source.trim()
      : undefined
  const description =
    typeof skill.description === 'string' && skill.description.trim().length > 0
      ? truncateInlineText(skill.description.trim())
      : undefined

  if (source && description) {
    return `${source}; ${description}`
  }
  return source ?? description
}

function formatReasoningBlock(block: ContentBlock): string | null {
  switch (block.type) {
    case 'reasoning':
      return `[reasoning] ${
        block.summary.length > 0
          ? block.summary.join(' ')
          : `status=${block.status ?? 'unknown'}`
      }`
    case 'thinking':
      return `[reasoning:thinking] ${block.thinking}`
    case 'redacted_thinking':
      return `[reasoning:redacted] hidden (${block.data.length} chars)`
    default:
      return null
  }
}

export function formatReasoningDeltaPrefix(
  kind: 'reasoning' | 'thinking',
): string {
  return kind === 'reasoning' ? '[reasoning] ' : '[reasoning:thinking] '
}

export function formatProgressThinkingLine(summary?: string): string {
  const normalized = summary?.trim()
  return normalized && normalized.length > 0 ? normalized : 'Working on it...'
}

function formatProgressAssistantLine(text: string): string {
  return `Assistant: ${text}`
}

export function formatProgressAssistantOutputLines(text: string): string[] {
  const normalized = text.trimEnd()
  if (normalized.length === 0) {
    return []
  }

  const lines = normalized.split(/\r?\n/)
  if (lines.length === 1) {
    return [`Assistant: ${lines[0]}`]
  }

  return ['Assistant:', normalized]
}

function formatContentBlock(block: ContentBlock): string | null {
  if (block.type === 'text') {
    return `[content] ${block.text}`
  }

  if (block.type === 'image') {
    return `[content:image] ${block.source.mediaType}`
  }

  return null
}

function formatToolCallBlock(block: ContentBlock): string | null {
  if (block.type !== 'tool_use') {
    return null
  }

  return formatToolUseText(block)
}

export function formatToolUseLine(toolUse: {
  name: string
  input: Record<string, unknown>
}): string {
  return formatToolUseText(toolUse)
}

export function formatProgressToolUseLine(toolUse: {
  name: string
  input: Record<string, unknown>
}): string {
  return formatToolUseText(toolUse)
}

export function formatProgressToolUseDisplayLine(toolUse: {
  name: string
  input: Record<string, unknown>
}): string {
  return `Tool: ${formatProgressToolUseLine(toolUse)}`
}

export function formatProgressToolResultLine(
  toolUse: ToolUseSummary | undefined,
  output: unknown,
): string {
  const toolName = toolUse?.name
  if (toolName === 'Agent') {
    const agentResultLine = formatAgentResultLine(toolUse, output)
    if (agentResultLine) {
      return agentResultLine
    }
  }
  const { summary, error } = getToolResultPayload(output)
  const action = toolUse
    ? formatToolResultActionText(toolUse)
    : summary ?? (toolName ? `${toolName}` : 'Tool')
  if (error) {
    return `${action} failed: ${error}`
  }

  const preview = getToolResultPreview(toolName, output)
  if (preview) {
    return `${action} (${preview})`
  }

  return action
}

export function formatProgressToolResultDisplayLine(
  toolUse: ToolUseSummary | undefined,
  output: unknown,
): string {
  return `Tool result: ${formatProgressToolResultLine(toolUse, output)}`
}

export function formatToolResultSummaryLine(
  toolUse: ToolUseSummary | undefined,
  output: unknown,
): string {
  return formatProgressToolResultLine(toolUse, output)
}

export function formatAutoCompactLine(
  event: AutoCompactNotice,
): string {
  return [
    '[autocompact]',
    `session=${event.sessionId}`,
    `boundary=${event.boundaryId}`,
    `summary=${event.summaryMessageId}`,
    `reason=${event.reason}`,
  ].join(' ')
}

export function formatMessageEventLines(
  messages: Message[],
  options: {
    includeToolCalls?: boolean
    includeReasoning?: boolean
    includeContent?: boolean
  } = {},
): string[] {
  const includeToolCalls = options.includeToolCalls ?? true
  const includeReasoning = options.includeReasoning ?? true
  const includeContent = options.includeContent ?? true
  const lines: string[] = []
  const toolUses = new Map<string, { name: string; input: Record<string, unknown> }>()

  for (const message of messages) {
    if (message.role === 'user') {
      if (!includeToolCalls) {
        continue
      }

      for (const block of message.content) {
        if (block.type !== 'tool_result') {
          continue
        }
        lines.push(
          formatToolResultSummaryLine(
            toolUses.get(block.toolUseId),
            block.rawOutput ?? block.output,
          ),
        )
      }
      continue
    }

    if (message.role !== 'assistant') {
      continue
    }

    for (const block of message.content) {
      if (includeReasoning) {
        const reasoningLine = formatReasoningBlock(block)
        if (reasoningLine) {
          lines.push(reasoningLine)
        }
      }

      if (includeContent) {
        const contentLine = formatContentBlock(block)
        if (contentLine) {
          lines.push(contentLine)
        }
      }

      if (includeToolCalls) {
        const toolCallLine = formatToolCallBlock(block)
        if (toolCallLine) {
          lines.push(toolCallLine)
        }
        if (block.type === 'tool_use') {
          toolUses.set(block.id, {
            name: block.name,
            input: block.input,
          })
        }
      }
    }
  }

  return lines
}

export function formatProgressReasoningLines(
  message: Pick<Message, 'role' | 'content'>,
): string[] {
  if (message.role !== 'assistant') {
    return []
  }

  const lines: string[] = []

  for (const block of message.content) {
    if (block.type !== 'reasoning' || block.summary.length === 0) {
      continue
    }

    const summary = block.summary.join(' ').trim()
    if (summary.length > 0) {
      lines.push(formatProgressThinkingLine(summary))
    }
  }

  return lines
}

function collectProgressReasoningTexts(
  message: Pick<Message, 'role' | 'content'>,
): string[] {
  if (message.role !== 'assistant') {
    return []
  }

  const reasoningLines = message.content
    .filter(
      (block): block is Extract<ContentBlock, { type: 'reasoning' }> =>
        block.type === 'reasoning',
    )
    .flatMap(block =>
      block.summary
        .map(normalizeProgressAssistantText)
        .filter((line): line is string => Boolean(line)),
    )
  if (reasoningLines.length > 0) {
    return reasoningLines
  }

  return message.content
    .filter(
      (block): block is Extract<ContentBlock, { type: 'thinking' }> =>
        block.type === 'thinking',
    )
    .map(block => normalizeProgressAssistantText(block.thinking))
    .filter((line): line is string => Boolean(line))
}

export function formatProgressAssistantLines(
  message: Pick<Message, 'role' | 'content'>,
): string[] {
  if (message.role !== 'assistant') {
    return []
  }

  const hasToolUse = message.content.some(block => block.type === 'tool_use')
  const textLines = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => normalizeProgressAssistantText(block.text))
    .filter((line): line is string => Boolean(line && line.trim().length > 0))

  if (hasToolUse && textLines.length > 0) {
    return textLines.map(formatProgressAssistantLine)
  }

  const reasoningLines = collectProgressReasoningTexts(message)
  if (reasoningLines.length > 0) {
    return reasoningLines.map(formatProgressAssistantLine)
  }

  return []
}

export function collectProgressAssistantTexts(
  message: Pick<Message, 'role' | 'content'>,
): string[] {
  if (message.role !== 'assistant') {
    return []
  }

  const hasToolUse = message.content.some(block => block.type === 'tool_use')
  const textLines = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => normalizeProgressAssistantText(block.text))
    .filter((line): line is string => Boolean(line))

  if (hasToolUse && textLines.length > 0) {
    return textLines
  }

  return collectProgressReasoningTexts(message)
}

export function collectToolCalls(messages: Message[]): ToolUseContentBlock[] {
  const toolCalls: ToolUseContentBlock[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }

    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolCalls.push(block)
      }
    }
  }

  return toolCalls
}

export function summarizeToolCalls(
  toolCalls: ToolUseContentBlock[],
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return toolCalls.map(block => ({
    id: block.id,
    name: block.name,
    input: block.input,
  }))
}
