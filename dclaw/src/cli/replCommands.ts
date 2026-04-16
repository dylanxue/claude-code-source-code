import { existsSync } from 'node:fs'
import type { QueryEngine } from '../core/queryEngine.js'
import { getModelLimitsConfigPath, resolveModelLimits } from '../llm/modelLimits.js'
import type { LlmProviderName } from '../llm/providerNames.js'
import { resolveLlmRuntimeConfig } from '../llm/runtimeConfig.js'
import { listSessionHistory } from '../session/history.js'
import { loadSessionForResume } from '../session/resume.js'
import { appendSessionMessages, createSession } from '../session/store.js'
import { formatTranscript } from '../session/transcript.js'
import { createTextMessage } from '../types/message.js'
import type { PermissionMode } from '../types/tool.js'
import {
  buildConfigAwareEnvWithSources,
  loadDclawConfigFiles,
} from './configFile.js'
import { runHistory } from './history.js'
import { ALL_PERMISSION_MODES } from './permissionModeConfig.js'
import type { CommonCliOptions } from './types.js'

export type ReplSessionState = {
  sessionId: string
  mode: 'interactive' | 'resume'
  provider: string
  providerSource: string
  model?: string
  modelSource: string
  permissionMode: string
  permissionModeSource: string
}

export type ReplCommandContext = {
  engine: QueryEngine
  options: CommonCliOptions
  session: ReplSessionState
}

type ReplCommandDefinition = {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  handle: (
    args: string[],
    context: ReplCommandContext,
  ) => Promise<void> | void
}

function printLines(lines: string[]): void {
  process.stdout.write(lines.join('\n') + '\n')
}

function statusLine(label: string, value: string): string {
  return `${label.padEnd(18)} ${value}`
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined
  }

  return parsed
}

function printSessionInfo(context: ReplCommandContext): void {
  printLines([
    'current session:',
    `session id: ${context.session.sessionId}`,
    `mode: ${context.session.mode}`,
    `cwd: ${context.options.cwd}`,
    `provider: ${context.session.provider}`,
    `provider source: ${context.session.providerSource}`,
    `model: ${context.session.model ?? 'default'}`,
    `model source: ${context.session.modelSource}`,
    `permission mode: ${context.session.permissionMode}`,
    `permission mode source: ${context.session.permissionModeSource}`,
    `stream: ${context.options.stream ? 'enabled' : 'disabled'}`,
    '',
  ])
}

function printTranscript(engine: QueryEngine, maxMessages?: number): void {
  const transcriptLines = formatTranscript(engine.getMessages(), {
    includeThinking: false,
    maxMessages,
  })

  printLines([
    typeof maxMessages === 'number'
      ? `current transcript (latest ${maxMessages} messages):`
      : 'current transcript:',
    ...(transcriptLines.length > 0 ? transcriptLines : ['<empty>']),
    '',
  ])
}

function clearTerminal(): void {
  process.stdout.write('\x1b[2J\x1b[H')
}

async function clearConversation(context: ReplCommandContext): Promise<void> {
  const nextSession = await createSession({
    cwd: context.options.cwd,
    mode: 'interactive',
    provider: context.session.provider,
    model: context.session.model,
  })

  context.engine.resetMessages()
  context.session.sessionId = nextSession.sessionId
  context.session.mode = 'interactive'

  printLines([
    'Started a new empty session.',
    `session id: ${nextSession.sessionId}`,
    '',
  ])
}

async function compactConversation(
  args: string[],
  context: ReplCommandContext,
): Promise<void> {
  const messages = context.engine.getMessages()
  if (messages.length === 0) {
    printLines([
      'Nothing to compact. The current conversation is already empty.',
      '',
    ])
    return
  }

  const transcriptLines = formatTranscript(messages, {
    includeThinking: false,
    maxMessages: 40,
  })
  const instructionText = args.join(' ').trim()
  const summaryText = [
    'Conversation summary from the previous session:',
    ...(transcriptLines.length > 0 ? transcriptLines : ['<empty>']),
    ...(instructionText
      ? ['', `Additional compact instructions: ${instructionText}`]
      : []),
  ].join('\n')
  const summaryMessage = createTextMessage('assistant', summaryText)
  const nextSession = await createSession({
    cwd: context.options.cwd,
    mode: 'interactive',
    provider: context.session.provider,
    model: context.session.model,
  })

  context.engine.resetMessages([summaryMessage])
  await appendSessionMessages(nextSession.sessionId, [summaryMessage])
  context.session.sessionId = nextSession.sessionId
  context.session.mode = 'interactive'

  printLines([
    'Compacted conversation into a summary and started a new session.',
    `session id: ${nextSession.sessionId}`,
    '',
  ])
}

async function printDoctor(context: ReplCommandContext): Promise<void> {
  const cwd = context.options.cwd
  const configured = await buildConfigAwareEnvWithSources(cwd)
  const runtime = resolveLlmRuntimeConfig(
    {
      provider: context.session.provider as LlmProviderName,
      model: context.session.model,
    },
    configured.env,
    key => configured.keySources[key],
  )
  const lines = [
    'dclaw doctor',
    '',
    statusLine('node', process.version),
    statusLine('platform', process.platform),
    statusLine('cwd', cwd),
    statusLine('cwd exists', existsSync(cwd) ? 'yes' : 'no'),
    statusLine('mode', 'repl'),
    statusLine('session id', context.session.sessionId),
    statusLine('session mode', context.session.mode),
    statusLine('permission mode', context.session.permissionMode),
    statusLine('permission source', context.session.permissionModeSource),
    statusLine('provider', runtime.provider),
    statusLine('provider source', context.session.providerSource),
  ]

  if (runtime.providerConfig.provider === 'anthropic') {
    const config = runtime.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', context.session.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.model) {
      appendModelLimitLines(lines, 'anthropic', runtime.model)
    }
  } else if (runtime.providerConfig.provider === 'openai') {
    const config = runtime.providerConfig
    lines.push(statusLine('api key', config.apiKey ? 'configured' : 'missing'))
    lines.push(statusLine('base url', config.baseUrl))
    lines.push(statusLine('api style', config.apiStyle))
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', context.session.modelSource))
    lines.push(statusLine('limits config', getLimitsConfigStatus()))
    if (runtime.model) {
      appendModelLimitLines(lines, 'openai', runtime.model)
    }
  } else {
    lines.push(statusLine('resolved model', runtime.model ?? 'none'))
    lines.push(statusLine('model source', context.session.modelSource))
  }

  printLines(lines)
}

function getLimitsConfigStatus(): string {
  const filePath = getModelLimitsConfigPath()
  return existsSync(filePath) ? filePath : `not found (${filePath})`
}

function appendModelLimitLines(
  lines: string[],
  provider: 'anthropic' | 'openai',
  model: string,
): void {
  const limits = resolveModelLimits(provider, model)
  lines.push(statusLine('context window', String(limits.contextWindow)))
  lines.push(statusLine('max output', String(limits.maxOutputTokens)))
  lines.push(
    statusLine('max output cap', String(limits.maxOutputTokensUpperLimit)),
  )
}

function printCurrentModel(context: ReplCommandContext): void {
  printLines([
    `Current model: ${context.session.model ?? 'default'}`,
    'Use /model <name> to switch models for this REPL session.',
    '',
  ])
}

function setCurrentModel(args: string[], context: ReplCommandContext): void {
  if (args.length === 0) {
    printCurrentModel(context)
    return
  }

  const nextModel = args.join(' ').trim()
  if (!nextModel) {
    printCurrentModel(context)
    return
  }

  context.engine.setModel(nextModel)
  context.session.model = nextModel
  context.session.modelSource = 'repl_command'

  printLines([
    `Model updated for this REPL session: ${nextModel}`,
    '',
  ])
}

function printCurrentPermissionMode(context: ReplCommandContext): void {
  printLines([
    `Current permission mode: ${context.session.permissionMode}`,
    `Available modes: ${ALL_PERMISSION_MODES.join(', ')}`,
    'Use /permissions <mode> to switch permission modes for this REPL session.',
    '',
  ])
}

function setCurrentPermissionMode(
  args: string[],
  context: ReplCommandContext,
): void {
  if (args.length === 0) {
    printCurrentPermissionMode(context)
    return
  }

  const nextPermissionMode = args.join(' ').trim()
  if (!ALL_PERMISSION_MODES.includes(nextPermissionMode as PermissionMode)) {
    printLines([
      `Invalid permission mode: ${nextPermissionMode}`,
      `Available modes: ${ALL_PERMISSION_MODES.join(', ')}`,
      '',
    ])
    return
  }

  context.engine.setPermissionMode(nextPermissionMode as PermissionMode)
  context.session.permissionMode = nextPermissionMode
  context.session.permissionModeSource = 'repl_command'

  printLines([
    `Permission mode updated for this REPL session: ${nextPermissionMode}`,
    '',
  ])
}

async function printConfig(context: ReplCommandContext): Promise<void> {
  const cwd = context.options.cwd
  const [configFiles, configured] = await Promise.all([
    loadDclawConfigFiles(cwd),
    buildConfigAwareEnvWithSources(cwd),
  ])
  const configKeyLines = Object.entries(configured.keySources)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, source]) => `${key} (${source})`)

  printLines([
    'dclaw config',
    '',
    `user config path: ${configFiles.userConfigPath}`,
    `user config: ${configFiles.userConfig ? 'loaded' : 'not found'}`,
    `workspace config path: ${configFiles.workspaceConfigPath}`,
    `workspace config: ${configFiles.workspaceConfig ? 'loaded' : 'not found'}`,
    `active permission mode: ${context.session.permissionMode} (${context.session.permissionModeSource})`,
    ...(configKeyLines.length > 0
      ? ['', 'config-backed env keys:', ...configKeyLines.map(line => `- ${line}`)]
      : ['', 'config-backed env keys: none']),
    '',
  ])
}

async function printResumeSuggestions(): Promise<void> {
  const sessions = await listSessionHistory()
  const lines = ['Usage: /resume <session-id>', '']

  if (sessions.length === 0) {
    lines.push('No saved sessions found yet.', '')
    printLines(lines)
    return
  }

  lines.push('Recent sessions:', '')
  sessions.slice(0, 5).forEach((session, index) => {
    lines.push(
      `${index + 1}. ${session.meta.sessionId}  ${session.meta.mode}  ${session.meta.updatedAt}`,
    )
    lines.push(`   cwd: ${session.meta.cwd}`)
    lines.push(
      `   provider: ${session.meta.provider}${session.meta.model ? ` / ${session.meta.model}` : ''}`,
    )
    if (session.lastUserText) {
      lines.push(`   last user: ${session.lastUserText}`)
    }
    if (session.lastAssistantText) {
      lines.push(`   last assistant: ${session.lastAssistantText}`)
    }
    if (index < Math.min(sessions.length, 5) - 1) {
      lines.push('')
    }
  })
  lines.push('', 'Use /resume <session-id> to switch this REPL to one of them.', '')
  printLines(lines)
}

async function resumeConversation(
  args: string[],
  context: ReplCommandContext,
): Promise<void> {
  const sessionId = args[0]?.trim()
  if (!sessionId) {
    await printResumeSuggestions()
    return
  }

  const resumed = await loadSessionForResume(sessionId)
  if (!resumed) {
    printLines([
      `Session not found: ${sessionId}`,
      '',
    ])
    return
  }

  context.engine.resetMessages(resumed.messages)
  context.session.sessionId = resumed.meta.sessionId
  context.session.mode = 'resume'

  if (resumed.meta.provider === context.session.provider && resumed.meta.model) {
    context.engine.setModel(resumed.meta.model)
    context.session.model = resumed.meta.model
    context.session.modelSource = 'resumed_session'
  }

  const transcriptLines = formatTranscript(resumed.messages, {
    includeThinking: false,
    maxMessages: 10,
  })

  printLines([
    `Resumed session: ${resumed.meta.sessionId}`,
    `stored provider/model: ${resumed.meta.provider}${resumed.meta.model ? ` / ${resumed.meta.model}` : ''}`,
    ...(resumed.meta.provider !== context.session.provider
      ? [
          `continuing with current provider: ${context.session.provider}`,
        ]
      : []),
    '',
    'restored transcript preview:',
    ...(transcriptLines.length > 0 ? transcriptLines : ['<empty>']),
    '',
  ])
}

const REPL_COMMANDS: ReplCommandDefinition[] = [
  {
    name: '/help',
    description: 'Show available REPL commands.',
    handle() {
      printLines([
        'REPL commands:',
        ...REPL_COMMANDS.map(command => {
          const aliases =
            command.aliases && command.aliases.length > 0
              ? ` (${command.aliases.join(', ')})`
              : ''
          const argumentHint = command.argumentHint
            ? ` ${command.argumentHint}`
            : ''
          return `${command.name}${argumentHint}${aliases}  ${command.description}`
        }),
        '',
      ])
    },
  },
  {
    name: '/session',
    aliases: ['/info'],
    description: 'Show current session info.',
    handle(_args, context) {
      printSessionInfo(context)
    },
  },
  {
    name: '/history',
    description: 'Show recent saved sessions.',
    async handle(_args, context) {
      await runHistory({
        mode: 'history',
        options: context.options,
      })
    },
  },
  {
    name: '/doctor',
    description: 'Show diagnostics for the current REPL session.',
    async handle(_args, context) {
      await printDoctor(context)
    },
  },
  {
    name: '/model',
    argumentHint: '[model]',
    description: 'Show or change the active model for this REPL session.',
    handle(args, context) {
      setCurrentModel(args, context)
    },
  },
  {
    name: '/permissions',
    argumentHint: '[mode]',
    description:
      'Show or change the active permission mode for this REPL session.',
    handle(args, context) {
      setCurrentPermissionMode(args, context)
    },
  },
  {
    name: '/config',
    description: 'Show loaded dclaw config files and config-backed env keys.',
    async handle(_args, context) {
      await printConfig(context)
    },
  },
  {
    name: '/transcript',
    argumentHint: '[N]',
    description:
      'Show the current conversation transcript, optionally limited to the latest N messages.',
    handle(args, context) {
      if (args.length === 0) {
        printTranscript(context.engine)
        return
      }

      const maxMessages = parsePositiveInteger(args[0])
      if (maxMessages === undefined) {
        printLines([
          'Invalid transcript limit. Use /transcript or /transcript <positive integer>.',
          '',
        ])
        return
      }

      printTranscript(context.engine, maxMessages)
    },
  },
  {
    name: '/resume',
    aliases: ['/continue'],
    argumentHint: '[session-id]',
    description:
      'Resume a saved session inside the current REPL, or list recent sessions when no id is provided.',
    async handle(args, context) {
      await resumeConversation(args, context)
    },
  },
  {
    name: '/compact',
    argumentHint: '[instructions]',
    description:
      'Compact the current conversation into a local summary and continue in a fresh session.',
    async handle(args, context) {
      await compactConversation(args, context)
    },
  },
  {
    name: '/clear',
    description: 'Clear conversation history and start a new empty session.',
    async handle(_args, context) {
      await clearConversation(context)
    },
  },
  {
    name: '/cls',
    description: 'Clear the terminal screen.',
    handle() {
      clearTerminal()
    },
  },
  {
    name: '/exit',
    aliases: ['/quit'],
    description: 'Exit the REPL.',
    handle() {
      // The REPL loop intercepts /exit before command dispatch.
    },
  },
]

function findReplCommand(name: string): ReplCommandDefinition | undefined {
  const normalized = name.toLowerCase()
  return REPL_COMMANDS.find(
    command =>
      command.name.toLowerCase() === normalized ||
      command.aliases?.some(alias => alias.toLowerCase() === normalized),
  )
}

export async function maybeHandleReplCommand(
  prompt: string,
  context: ReplCommandContext,
): Promise<boolean> {
  const trimmedPrompt = prompt.trim()
  const [commandName, ...args] = trimmedPrompt.split(/\s+/)
  const command = findReplCommand(commandName)

  if (!command) {
    return false
  }

  await command.handle(args, context)
  return true
}
