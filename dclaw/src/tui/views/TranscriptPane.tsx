import { basename } from 'node:path'
import React from 'react'
import { Box, Text } from '../../ink/index.js'
import type { WelcomeCardData } from '../../cli/welcome.js'
import type {
  ActivityEntry,
  PlanModeSnapshot,
  StructuredCardEntry,
  TaskListSnapshot,
  TranscriptItem,
} from '../state/index.js'
import { WelcomeCard } from './WelcomeCard.js'

type Props = {
  activeStatusText?: string
  entries: TranscriptItem[]
  showWelcomeCard?: boolean
  welcomeCard: WelcomeCardData
}

export const MAIN_SCREEN_TRANSCRIPT_CAP = 200
export const MAIN_SCREEN_TRANSCRIPT_STEP = 50

export type TranscriptSliceAnchor = {
  id: string
  index: number
} | null

type TranscriptSliceAnchorRef = {
  current: TranscriptSliceAnchor
}

type AssistantStreamChunkEntry = Extract<
  TranscriptItem,
  { kind: 'assistant_stream_chunk' }
>

type TranscriptSliceUnit = {
  id: string
  entryIndex: number
}

export type TranscriptRenderItem =
  | {
      id: string
      kind: 'entry'
      entry: TranscriptItem
      nextEntry?: TranscriptItem
      previousEntry?: TranscriptItem
    }
  | {
      id: string
      kind: 'stream_group'
      entries: AssistantStreamChunkEntry[]
      nextEntry?: TranscriptItem
      previousEntry?: TranscriptItem
      text: string
    }

function getTranscriptSliceUnits(
  entries: ReadonlyArray<Pick<TranscriptItem, 'id' | 'kind'>>,
): TranscriptSliceUnit[] {
  const units: TranscriptSliceUnit[] = []

  entries.forEach((entry, entryIndex) => {
    if (
      entry.kind === 'assistant_stream_chunk' &&
      entries[entryIndex - 1]?.kind === 'assistant_stream_chunk'
    ) {
      return
    }

    units.push({
      id: entry.id,
      entryIndex,
    })
  })

  return units
}

type MultilineTextBlockProps = {
  text: string
  prefix: string
  dimColor?: boolean
}

function MultilineTextBlock({
  text,
  prefix,
  dimColor = false,
}: MultilineTextBlockProps) {
  const lines = text.split('\n')

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${prefix}-${index}`} dimColor={dimColor}>
          {index === 0 ? `${prefix}${line}` : `  ${line}`}
        </Text>
      ))}
    </Box>
  )
}

function StreamingTextBlock({
  showBullet,
  text,
}: {
  showBullet: boolean
  text: string
}) {
  const displayText = text.endsWith('\n') ? text.slice(0, -1) : text
  if (displayText.length === 0) {
    return null
  }

  return (
    <MultilineTextBlock
      prefix={showBullet ? '• ' : '  '}
      text={displayText}
    />
  )
}

export function getTranscriptEntryMarginBottom(
  entry: TranscriptItem,
  nextEntry?: TranscriptItem,
): number {
  if (
    entry.kind === 'assistant_stream_chunk' &&
    nextEntry?.kind === 'assistant_stream_chunk'
  ) {
    return 0
  }

  return 1
}

export function computeTranscriptSliceStart(
  entries: ReadonlyArray<Pick<TranscriptItem, 'id' | 'kind'>>,
  anchorRef: TranscriptSliceAnchorRef,
  cap = MAIN_SCREEN_TRANSCRIPT_CAP,
  step = MAIN_SCREEN_TRANSCRIPT_STEP,
): number {
  const normalizedCap = Math.max(1, cap)
  const normalizedStep = Math.max(0, step)
  const units = getTranscriptSliceUnits(entries)

  if (units.length === 0) {
    anchorRef.current = null
    return 0
  }

  let unitStart = 0
  const maxUnitStart = Math.max(0, units.length - normalizedCap)
  const anchor = anchorRef.current

  if (units.length > normalizedCap) {
    if (!anchor) {
      unitStart = maxUnitStart
    } else {
      const anchorIndex = units.findIndex(unit => unit.id === anchor.id)
      unitStart =
        anchorIndex >= 0 ? anchorIndex : Math.min(anchor.index, maxUnitStart)

      if (units.length - unitStart > normalizedCap + normalizedStep) {
        unitStart = maxUnitStart
      }
    }
  }

  const unitAtStart = units[unitStart]
  anchorRef.current = {
    id: unitAtStart?.id ?? units[0].id,
    index: unitStart,
  }

  return unitAtStart?.entryIndex ?? 0
}

export function getTranscriptRenderItems(
  entries: TranscriptItem[],
): TranscriptRenderItem[] {
  const renderItems: TranscriptRenderItem[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }

    if (entry.kind !== 'assistant_stream_chunk') {
      renderItems.push({
        id: entry.id,
        kind: 'entry',
        entry,
        nextEntry: entries[index + 1],
        previousEntry: entries[index - 1],
      })
      continue
    }

    const streamEntries: AssistantStreamChunkEntry[] = [entry]
    let nextIndex = index + 1
    while (entries[nextIndex]?.kind === 'assistant_stream_chunk') {
      streamEntries.push(entries[nextIndex] as AssistantStreamChunkEntry)
      nextIndex += 1
    }

    renderItems.push({
      id: entry.id,
      kind: 'stream_group',
      entries: streamEntries,
      nextEntry: entries[nextIndex],
      previousEntry: entries[index - 1],
      text: streamEntries.map(streamEntry => streamEntry.text).join(''),
    })
    index = nextIndex - 1
  }

  return renderItems
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function getToolPayload(value: unknown): unknown {
  const record = asRecord(value)
  return record && 'output' in record ? record.output : value
}

function getInputString(
  input: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = input?.[key]
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function getReadFilename(entry: ActivityEntry): string | undefined {
  const filePath =
    getInputString(entry.input, 'file_path') ?? getInputString(entry.input, 'path')
  return filePath ? basename(filePath) : undefined
}

function getBashCommand(entry: ActivityEntry): string | undefined {
  return getInputString(entry.input, 'command')
}

function getQuestionAnswerRows(entry: ActivityEntry): Array<{
  answer: string
  question: string
}> {
  const inputQuestions = Array.isArray(entry.input?.questions)
    ? entry.input.questions
    : []
  const payload = asRecord(getToolPayload(entry.output))
  const answers = asRecord(payload?.answers)
  if (!answers) {
    return []
  }

  return inputQuestions
    .map(questionValue => {
      const question = asRecord(questionValue)
      const prompt =
        typeof question?.question === 'string' ? question.question.trim() : ''
      const key =
        typeof question?.id === 'string' && question.id.trim().length > 0
          ? question.id.trim()
          : prompt
      const answerValue = answers[key]
      const answer =
        typeof answerValue === 'string' ? answerValue.trim() : undefined
      return prompt && answer ? { question: prompt, answer } : undefined
    })
    .filter((row): row is { answer: string; question: string } => Boolean(row))
}

function getBashOutputPreview(entry: ActivityEntry): string[] {
  const payload = asRecord(getToolPayload(entry.output))
  if (!payload) {
    return []
  }

  const stdout = typeof payload.stdout === 'string' ? payload.stdout.trimEnd() : ''
  const stderr = typeof payload.stderr === 'string' ? payload.stderr.trimEnd() : ''
  const text = stdout || stderr
  if (!text) {
    const exitCode = typeof payload.exitCode === 'number' ? payload.exitCode : undefined
    return exitCode === undefined ? [] : [`exit ${exitCode}`]
  }

  const lines = text.split(/\r?\n/)
  if (lines.length <= 5) {
    return lines
  }

  const head = lines.slice(0, 2)
  const tail = lines.slice(-2)
  return [...head, `... +${lines.length - 4} lines`, ...tail]
}

function StructuredCard({ title, entries }: {
  title: string
  entries: StructuredCardEntry[]
}) {
  const rowLabelWidth = entries.reduce((maxWidth, entry) => {
    if (entry.kind !== 'row') {
      return maxWidth
    }

    return Math.max(maxWidth, entry.label.length)
  }, 0)

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text bold>{title}</Text>
      {entries.length > 0 ? <Box marginBottom={1} /> : null}
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') {
          return <Box key={`sep-${index}`} marginBottom={1} />
        }

        if (entry.kind === 'text') {
          return (
            <Text key={`text-${index}`} dimColor>
              {entry.text}
            </Text>
          )
        }

        return (
          <Text key={`row-${index}`} wrap="truncate-end">
            <Text dimColor>{`${entry.label.padEnd(rowLabelWidth)}  `}</Text>
            {entry.value}
          </Text>
        )
      })}
    </Box>
  )
}

function TimeSeparator({ text }: { text: string }) {
  return (
    <Text dimColor>{`─ ${text} ─`}</Text>
  )
}

function getTaskStatusGlyph(status: TaskListSnapshot['tasks'][number]['status']): string {
  switch (status) {
    case 'completed':
      return 'x'
    case 'in_progress':
      return '>'
    case 'cancelled':
      return '-'
    case 'pending':
      return ' '
  }
}

function getTaskStatusColor(
  status: TaskListSnapshot['tasks'][number]['status'],
): string | undefined {
  switch (status) {
    case 'completed':
      return 'green'
    case 'in_progress':
      return 'cyan'
    case 'cancelled':
      return 'gray'
    case 'pending':
      return undefined
  }
}

function TaskListSnapshotCard({
  collapsed,
  snapshot,
}: {
  collapsed: boolean
  snapshot: TaskListSnapshot
}) {
  const title = snapshot.title ? `Tasks - ${snapshot.title}` : 'Tasks'
  const summary = `${snapshot.completedCount}/${snapshot.totalCount} completed`
  const currentTask = snapshot.tasks.find(task => task.isCurrent)

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text>
        <Text bold>{title}</Text>
        <Text dimColor>{` - ${summary}`}</Text>
      </Text>
      {collapsed ? (
        <Text dimColor wrap="truncate-end">
          {currentTask
            ? `current: #${currentTask.id} ${currentTask.subject}`
            : `state: ${snapshot.executionState}`}
        </Text>
      ) : null}
      {collapsed ? null : (
        <>
          <Box marginBottom={1} />
          {snapshot.tasks.map(task => {
            const blocked =
              task.blockedBy.length > 0
                ? ` blocked by ${task.blockedBy.map(id => `#${id}`).join(', ')}`
                : ''
            const owner = task.owner ? ` ${task.owner}` : ''
            const current = task.isCurrent ? ' (current)' : ''

            return (
              <Text key={task.id} wrap="truncate-end">
                <Text color={getTaskStatusColor(task.status)}>
                  {`[${getTaskStatusGlyph(task.status)}]`}
                </Text>
                {` #${task.id} `}
                <Text bold={task.isCurrent}>{task.subject}</Text>
                <Text dimColor>{`${current}${owner}${blocked}`}</Text>
              </Text>
            )
          })}
          <Text dimColor>{`state: ${snapshot.executionState}`}</Text>
        </>
      )}
    </Box>
  )
}

function PlanModeSnapshotCard({ snapshot }: { snapshot: PlanModeSnapshot }) {
  const title = 'Plan Mode'
  const entries = [
    `state: ${snapshot.status}`,
    ...(snapshot.planFilePath ? [`file: ${snapshot.planFilePath}`] : []),
    ...(snapshot.resumePermissionMode
      ? [`resume permissions: ${snapshot.resumePermissionMode}`]
      : []),
  ]

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text bold>{title}</Text>
      <Box marginBottom={1} />
      {entries.map((entry, index) => (
        <Text key={`${snapshot.sessionId}-${index}`} dimColor wrap="truncate-end">
          {entry}
        </Text>
      ))}
    </Box>
  )
}

function ExploredActivityGroup({ entries }: { entries: ActivityEntry[] }) {
  const readNames = entries
    .filter(entry => entry.toolName === 'Read')
    .map(getReadFilename)
    .filter((name): name is string => Boolean(name))
  const otherEntries = entries.filter(entry => entry.toolName !== 'Read')

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>• </Text>
        <Text bold>Explored</Text>
      </Text>
      {readNames.length > 0 ? (
        <Box paddingLeft={2}>
          <Text>
            <Text dimColor>└ </Text>
            <Text color="cyan">Read </Text>
            {readNames.join(', ')}
          </Text>
        </Box>
      ) : null}
      {otherEntries.map(entry => {
        const command = entry.toolName === 'Bash' ? getBashCommand(entry) : undefined
        const label =
          entry.toolName === 'Bash'
            ? 'List'
            : entry.toolName === 'Glob'
              ? 'List'
              : entry.toolName === 'Grep'
                ? 'Search'
                : entry.toolName ?? 'Tool'
        const detail = command ?? entry.text.replace(/^(Searched|Searching|Ran|Running)\s+/u, '')

        return (
          <Box key={entry.toolUseId} paddingLeft={2}>
            <Text>
              <Text dimColor>└ </Text>
              <Text color="cyan">{label} </Text>
              {detail}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

function QuestionsActivityGroup({ entries }: { entries: ActivityEntry[] }) {
  const rows = entries.flatMap(getQuestionAnswerRows)
  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text dimColor>• </Text>
          <Text bold>Questions</Text>
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>• </Text>
        <Text bold>Questions</Text>
        <Text dimColor>{` ${rows.length}/${rows.length} answered`}</Text>
      </Text>
      {rows.map((row, index) => (
        <Box key={`${index}-${row.question}`} flexDirection="column" paddingLeft={2}>
          <Text>{`• ${row.question}`}</Text>
          <Box paddingLeft={2}>
            <Text>
              <Text dimColor>answer: </Text>
              <Text color="cyan">{row.answer}</Text>
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function RanActivityGroup({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Box flexDirection="column">
      {entries.map((entry, index) => {
        const command = getBashCommand(entry) ?? entry.text.replace(/^Ran\s+/u, '')
        const outputLines = getBashOutputPreview(entry)

        return (
          <Box
            key={entry.toolUseId}
            flexDirection="column"
            marginBottom={index < entries.length - 1 ? 1 : 0}
          >
            <Text>
              <Text color="green">• </Text>
              <Text bold>Ran </Text>
              <Text color="cyan">{command}</Text>
            </Text>
            {outputLines.map((line, index) => (
              <Box key={`${entry.toolUseId}-out-${index}`} paddingLeft={2}>
                <Text dimColor>{index === 0 ? `└ ${line}` : `  ${line}`}</Text>
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

function ActivityGroup({ entry }: { entry: Extract<TranscriptItem, { kind: 'activity_group' }> }) {
  if (entry.title === 'Explored') {
    return <ExploredActivityGroup entries={entry.entries} />
  }

  if (entry.title === 'Questions') {
    return <QuestionsActivityGroup entries={entry.entries} />
  }

  if (entry.title === 'Ran') {
    return <RanActivityGroup entries={entry.entries} />
  }

  return (
    <Box flexDirection="column">
      <Text>{`• ${entry.title}`}</Text>
      {entry.entries.map(activityEntry => (
        <Box key={activityEntry.toolUseId} paddingLeft={2}>
          <Text>{`└ ${activityEntry.text}`}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function TranscriptPane({
  activeStatusText,
  entries,
  showWelcomeCard = true,
  welcomeCard,
}: Props) {
  const renderItems = getTranscriptRenderItems(entries)

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingTop={1}>
      {showWelcomeCard ? (
        <Box marginBottom={1} flexDirection="column">
          <WelcomeCard card={welcomeCard} />
        </Box>
      ) : null}
      {renderItems.map(item =>
        item.kind === 'stream_group' ? (
          <TranscriptStreamGroup key={item.id} item={item} />
        ) : (
          <TranscriptEntry
            key={item.id}
            entry={item.entry}
            nextEntry={item.nextEntry}
            previousEntry={item.previousEntry}
          />
        ),
      )}
      {activeStatusText ? (
        <Box marginBottom={1}>
          <MultilineTextBlock dimColor prefix="• " text={activeStatusText} />
        </Box>
      ) : null}
    </Box>
  )
}

function TranscriptStreamGroup({
  item,
}: {
  item: Extract<TranscriptRenderItem, { kind: 'stream_group' }>
}) {
  const lastEntry = item.entries.at(-1) ?? item.entries[0]

  return (
    <Box
      flexDirection="column"
      marginBottom={getTranscriptEntryMarginBottom(lastEntry, item.nextEntry)}
    >
      <StreamingTextBlock
        showBullet={item.previousEntry?.kind !== 'assistant_stream_chunk'}
        text={item.text}
      />
    </Box>
  )
}

function TranscriptEntry({
  entry,
  nextEntry,
  previousEntry,
}: {
  entry: TranscriptItem
  nextEntry?: TranscriptItem
  previousEntry?: TranscriptItem
}) {
  return (
    <Box
      flexDirection="column"
      marginBottom={getTranscriptEntryMarginBottom(entry, nextEntry)}
    >
      {entry.kind === 'user_prompt' ? (
        <Box backgroundColor="#f2f2f2" paddingX={1} paddingY={1}>
          <Text color="black">{`› ${entry.text}`}</Text>
        </Box>
      ) : entry.kind === 'user_command' ? (
        <Text color="cyan">{entry.text}</Text>
      ) : entry.kind === 'assistant_stream_chunk' ? (
        <StreamingTextBlock
          showBullet={previousEntry?.kind !== 'assistant_stream_chunk'}
          text={entry.text}
        />
      ) : entry.kind === 'activity_group' ? (
        <ActivityGroup entry={entry} />
      ) : entry.kind === 'structured_card' ? (
        <StructuredCard title={entry.title} entries={entry.entries} />
      ) : entry.kind === 'task_list_snapshot' ? (
        <TaskListSnapshotCard
          collapsed={entry.collapsed}
          snapshot={entry.snapshot}
        />
      ) : entry.kind === 'plan_mode_snapshot' ? (
        <PlanModeSnapshotCard snapshot={entry.snapshot} />
      ) : entry.kind === 'time_separator' ? (
        <TimeSeparator text={entry.text} />
      ) : entry.kind === 'system' ? (
        <MultilineTextBlock dimColor prefix="" text={entry.text} />
      ) : (
        <MultilineTextBlock prefix="• " text={entry.text} />
      )}
    </Box>
  )
}
