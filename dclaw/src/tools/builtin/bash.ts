import { exec, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import {
  getBackgroundTasksDir,
  getToolResultsDir,
} from '../../session/paths.js'
import type { ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'

const execAsync = promisify(exec)
const DEFAULT_TIMEOUT_MS = getEnvTimeout(
  process.env.BASH_DEFAULT_TIMEOUT_MS,
  120_000,
)
const MAX_TIMEOUT_MS = getEnvTimeout(
  process.env.BASH_MAX_TIMEOUT_MS,
  600_000,
  DEFAULT_TIMEOUT_MS,
)

const BASH_SEARCH_COMMANDS = new Set([
  'find',
  'grep',
  'rg',
  'ag',
  'ack',
  'locate',
  'which',
  'whereis',
])
const BASH_READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'pwd',
  'wc',
  'stat',
  'file',
  'strings',
  'jq',
  'awk',
  'cut',
  'sort',
  'uniq',
  'tr',
])
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du'])
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set([
  'echo',
  'printf',
  'true',
  'false',
  ':',
])
const BASH_SILENT_COMMANDS = new Set([
  'mv',
  'cp',
  'rm',
  'mkdir',
  'rmdir',
  'chmod',
  'chown',
  'chgrp',
  'touch',
  'ln',
  'cd',
  'export',
  'unset',
  'wait',
])
const MAX_INLINE_OUTPUT_CHARS = 12_000
const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
])
const GIT_READ_ONLY_BRANCH_FLAGS = new Set([
  '-a',
  '-r',
  '-v',
  '-vv',
  '--all',
  '--remotes',
  '--show-current',
  '--list',
])
const SAFE_ENV_VARS = new Set([
  'GOEXPERIMENT',
  'GOOS',
  'GOARCH',
  'CGO_ENABLED',
  'GO111MODULE',
  'RUST_BACKTRACE',
  'RUST_LOG',
  'NODE_ENV',
  'PYTHONUNBUFFERED',
  'PYTHONDONTWRITEBYTECODE',
  'PYTEST_DISABLE_PLUGIN_AUTOLOAD',
  'PYTEST_DEBUG',
  'ANTHROPIC_API_KEY',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_TIME',
  'CHARSET',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'TZ',
  'LS_COLORS',
  'LSCOLORS',
  'GREP_COLOR',
  'GREP_COLORS',
  'GCC_COLORS',
  'TIME_STYLE',
  'BLOCK_SIZE',
  'BLOCKSIZE',
])
const SAFE_ENV_VAR_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z0-9_./:-]+)[ \t]+/

export type BashToolInput = {
  command: string
  timeout?: number
  description?: string
  run_in_background?: boolean
  dangerouslyDisableSandbox?: boolean
}

export type BashSandboxMode = 'restricted' | 'danger-full-access'

export type BashToolOutput = {
  command: string
  stdout: string
  stderr: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
  exitCode: number
  interrupted: boolean
  sandboxMode: BashSandboxMode
  executionMode: 'foreground' | 'background'
  noOutputExpected?: boolean
  dangerouslyDisableSandbox?: boolean
  returnCodeInterpretation?: string
  backgroundTaskId?: string
  persistedOutputPath?: string
  persistedOutputSize?: number
}

function getEnvTimeout(
  value: string | undefined,
  fallback: number,
  minimum: number = 1,
): number {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < minimum) {
    return fallback
  }

  return parsed
}

function splitCommandWithOperators(command: string): string[] {
  return command.match(/&>>|&>|>>|>\||>&|&&|\|\||[|;&>]|[^|;&>]+/g) ?? []
}

function tokenizeCommand(part: string): string[] {
  return part
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 0)
}

function tokenizeShellSyntax(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  const pushCurrent = (): void => {
    if (current.length > 0) {
      tokens.push(current)
      current = ''
    }
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (!char) {
      continue
    }

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    if (!inDoubleQuote && char === "'") {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (inSingleQuote || inDoubleQuote) {
      current += char
      continue
    }

    if (/\s/.test(char)) {
      pushCurrent()
      continue
    }

    if (char === '>' || char === '|' || char === '&' || char === ';') {
      pushCurrent()

      if (char === ';') {
        tokens.push(';')
        continue
      }

      if (char === '|' && next === '|') {
        tokens.push('||')
        index += 1
        continue
      }

      if (char === '&' && next === '&') {
        tokens.push('&&')
        index += 1
        continue
      }

      if (char === '&' && next === '>') {
        if (command[index + 2] === '>') {
          tokens.push('&>>')
          index += 2
          continue
        }

        tokens.push('&>')
        index += 1
        continue
      }

      if (char === '>') {
        const previousToken = tokens[tokens.length - 1]
        const fileDescriptorPrefix =
          previousToken && /^\d+$/.test(previousToken) ? previousToken : ''
        if (fileDescriptorPrefix) {
          tokens.pop()
        }

        if (next === '>') {
          tokens.push(`${fileDescriptorPrefix}>>`)
          index += 1
          continue
        }

        if (next === '&') {
          tokens.push(`${fileDescriptorPrefix}>&`)
          index += 1
          continue
        }

        if (next === '|') {
          tokens.push(`${fileDescriptorPrefix}>|`)
          index += 1
          continue
        }

        tokens.push(`${fileDescriptorPrefix}>`)
        continue
      }

      tokens.push(char)
      continue
    }

    current += char
  }

  pushCurrent()
  return tokens
}

function stripLeadingSafeEnvVars(command: string): string {
  let stripped = command.trim()
  let previous = ''

  while (stripped && stripped !== previous) {
    previous = stripped
    const match = stripped.match(SAFE_ENV_VAR_PATTERN)
    if (!match) {
      break
    }

    const variableName = match[1]
    if (!variableName || !SAFE_ENV_VARS.has(variableName)) {
      break
    }

    stripped = stripped.replace(SAFE_ENV_VAR_PATTERN, '')
  }

  return stripped.trim()
}

function stripLeadingSafeWrappers(command: string): string {
  let stripped = command.trim()
  let previous = ''

  while (stripped && stripped !== previous) {
    previous = stripped

    stripped = stripped
      .replace(
        /^timeout[ \t]+(?:(?:--(?:foreground|preserve-status|verbose)|--(?:kill-after|signal)=[A-Za-z0-9_.+-]+|--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+|-v|-[ks][ \t]+[A-Za-z0-9_.+-]+|-[ks][A-Za-z0-9_.+-]+)[ \t]+)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
        '',
      )
      .replace(/^time[ \t]+(?:--[ \t]+)?/, '')
      .replace(/^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/, '')
      .replace(/^stdbuf(?:[ \t]+-[ioe][LN0-9]+)+[ \t]+(?:--[ \t]+)?/, '')
      .replace(/^nohup[ \t]+(?:--[ \t]+)?/, '')
      .trim()
  }

  return stripped
}

function normalizeShellCommand(command: string): string {
  return stripLeadingSafeWrappers(stripLeadingSafeEnvVars(command))
}

type OutputRedirection = {
  target: string
  operator: '>' | '>>' | '>|' | '&>' | '&>>'
}

function hasDangerousRedirectionTarget(target: string): boolean {
  if (target.length === 0 || target === '/dev/null') {
    return false
  }

  return (
    target.includes('$') ||
    target.includes('%') ||
    target.includes('`') ||
    target.includes('*') ||
    target.includes('?') ||
    target.includes('[') ||
    target.includes('{') ||
    target.startsWith('!') ||
    target.startsWith('=') ||
    target.startsWith('~') ||
    target.includes('<') ||
    target.includes('(')
  )
}

function hasShellExecutionSyntax(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (!char) {
      continue
    }

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    if (!inDoubleQuote && char === "'") {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (inSingleQuote) {
      continue
    }

    if (char === '`') {
      return true
    }

    if (char === '$' && next === '(') {
      return true
    }

    if ((char === '<' || char === '>') && next === '(') {
      return true
    }
  }

  return false
}

function extractOutputRedirections(command: string): {
  redirections: OutputRedirection[]
  hasDangerousRedirection: boolean
} {
  const tokens = tokenizeShellSyntax(command)
  const redirections: OutputRedirection[] = []
  let hasDangerousRedirection = false

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) {
      continue
    }

    const duplicationMatch = token.match(/^(?:\d+)?>&$/)
    if (duplicationMatch) {
      const nextToken = tokens[index + 1]
      if (!nextToken) {
        hasDangerousRedirection = true
        continue
      }

      if (/^\d+$/.test(nextToken) || nextToken.startsWith('&')) {
        index += 1
        continue
      }

      if (hasDangerousRedirectionTarget(nextToken)) {
        hasDangerousRedirection = true
        index += 1
        continue
      }

      redirections.push({
        target: nextToken,
        operator: '>',
      })
      index += 1
      continue
    }

    const redirectionMatch = token.match(/^(?:\d+)?(>>|>|>\|)$|^(&>>|&>)$/)
    if (!redirectionMatch) {
      continue
    }

    const nextToken = tokens[index + 1]
    if (!nextToken) {
      hasDangerousRedirection = true
      continue
    }

    if (nextToken.startsWith('&')) {
      index += 1
      continue
    }

    if (hasDangerousRedirectionTarget(nextToken)) {
      hasDangerousRedirection = true
      index += 1
      continue
    }

    redirections.push({
      target: nextToken,
      operator:
        redirectionMatch[2] === '&>>'
          ? '&>>'
          : redirectionMatch[2] === '&>'
            ? '&>'
            : redirectionMatch[1] === '>>'
          ? '>>'
          : redirectionMatch[1] === '>|'
            ? '>|'
            : '>',
    })
    index += 1
  }

  return { redirections, hasDangerousRedirection }
}

function hasPotentialFileOutputRedirection(command: string): boolean {
  const { redirections, hasDangerousRedirection } = extractOutputRedirections(
    command,
  )
  return redirections.length > 0 || hasDangerousRedirection
}

function commandHasCompoundCd(command: string): boolean {
  const tokens = tokenizeShellSyntax(command)
  if (!tokens.some(token => token === '&&' || token === '||' || token === ';' || token === '|')) {
    return false
  }

  let segment: string[] = []
  for (const token of [...tokens, ';']) {
    if (token === '&&' || token === '||' || token === ';' || token === '|') {
      const normalized = normalizeShellCommand(segment.join(' '))
      const baseCommand = tokenizeCommand(normalized)[0]
      if (baseCommand === 'cd') {
        return true
      }
      segment = []
      continue
    }

    segment.push(token)
  }

  return false
}

export function getBashManualApprovalReason(command: string): string | undefined {
  const { redirections, hasDangerousRedirection } = extractOutputRedirections(
    command,
  )

  if (hasDangerousRedirection) {
    return 'Shell expansion syntax in Bash output redirection requires manual approval.'
  }

  if (redirections.length > 0 && commandHasCompoundCd(command)) {
    return "Commands that combine 'cd' with output redirection require manual approval."
  }

  if (hasShellExecutionSyntax(command)) {
    return 'Shell command substitution and process substitution in Bash require manual approval.'
  }

  return undefined
}

function isReadOnlyGitCommand(part: string): boolean {
  const tokens = tokenizeCommand(normalizeShellCommand(part))
  if (tokens[0] !== 'git') {
    return false
  }

  const subcommand = tokens[1]
  if (!subcommand) {
    return false
  }

  if (GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return true
  }

  if (subcommand === 'branch') {
    const args = tokens.slice(2)
    if (args.length === 0) {
      return true
    }

    return args.every(arg => GIT_READ_ONLY_BRANCH_FLAGS.has(arg))
  }

  return false
}

function classifyBashCommand(command: string): {
  isSearch: boolean
  isRead: boolean
  isList: boolean
} {
  if (hasShellExecutionSyntax(command)) {
    return { isSearch: false, isRead: false, isList: false }
  }

  // Output redirections write to a destination, so we conservatively avoid
  // classifying the command as read-only unless we have a real shell parser.
  if (hasPotentialFileOutputRedirection(command)) {
    return { isSearch: false, isRead: false, isList: false }
  }

  const parts = splitCommandWithOperators(command)
  if (parts.length === 0) {
    return { isSearch: false, isRead: false, isList: false }
  }

  let hasSearch = false
  let hasRead = false
  let hasList = false
  let hasNonNeutralCommand = false
  let skipNextAsRedirectTarget = false

  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) {
      continue
    }

    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false
      continue
    }

    if (
      part === '>' ||
      part === '>>' ||
      part === '>|' ||
      part === '>&' ||
      part === '&>' ||
      part === '&>>'
    ) {
      skipNextAsRedirectTarget = true
      continue
    }

    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      continue
    }

    const normalizedPart = normalizeShellCommand(part)
    const baseCommand = normalizedPart.split(/\s+/)[0]
    if (!baseCommand) {
      continue
    }

    if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue
    }

    hasNonNeutralCommand = true
    const isSearch = BASH_SEARCH_COMMANDS.has(baseCommand)
    const isRead =
      BASH_READ_COMMANDS.has(baseCommand) || isReadOnlyGitCommand(normalizedPart)
    const isList = BASH_LIST_COMMANDS.has(baseCommand)

    if (!isSearch && !isRead && !isList) {
      return { isSearch: false, isRead: false, isList: false }
    }

    hasSearch ||= isSearch
    hasRead ||= isRead
    hasList ||= isList
  }

  if (!hasNonNeutralCommand) {
    return { isSearch: false, isRead: false, isList: false }
  }

  return { isSearch: hasSearch, isRead: hasRead, isList: hasList }
}

function isSilentBashCommand(command: string): boolean {
  const parts = splitCommandWithOperators(command)
  if (parts.length === 0) {
    return false
  }

  let hasNonFallbackCommand = false
  let lastOperator: string | null = null
  let skipNextAsRedirectTarget = false

  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) {
      continue
    }

    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false
      continue
    }

    if (
      part === '>' ||
      part === '>>' ||
      part === '>|' ||
      part === '>&' ||
      part === '&>' ||
      part === '&>>'
    ) {
      skipNextAsRedirectTarget = true
      continue
    }

    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      lastOperator = part
      continue
    }

    const baseCommand = part.split(/\s+/)[0]
    if (!baseCommand) {
      continue
    }

    if (
      lastOperator === '||' &&
      BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)
    ) {
      continue
    }

    hasNonFallbackCommand = true
    if (!BASH_SILENT_COMMANDS.has(baseCommand)) {
      return false
    }
  }

  return hasNonFallbackCommand
}

function truncateOutput(
  text: string,
  maxChars: number,
): {
  text: string
  wasTruncated: boolean
} {
  if (text.length <= maxChars) {
    return {
      text,
      wasTruncated: false,
    }
  }

  const omitted = text.length - maxChars
  return {
    text:
      text.slice(0, maxChars) +
      `\n... [truncated ${omitted} more characters by dclaw]`,
    wasTruncated: true,
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildPersistedOutputPayload(input: {
  mode: 'foreground'
  cwd: string
  command: string
  stdout: string
  stderr: string
  exitCode: number
  interrupted: boolean
  sandboxMode: BashSandboxMode
}): string {
  return [
    '# dclaw bash output',
    `mode: ${input.mode}`,
    `cwd: ${input.cwd}`,
    `exit_code: ${input.exitCode}`,
    `interrupted: ${input.interrupted ? 'true' : 'false'}`,
    `sandbox_mode: ${input.sandboxMode}`,
    '',
    '# command',
    input.command,
    '',
    '# stdout',
    input.stdout,
    '',
    '# stderr',
    input.stderr,
  ].join('\n')
}

async function ensureBackgroundTasksDir(cwd: string): Promise<string> {
  void cwd
  const directoryPath = getBackgroundTasksDir(process.env)
  await mkdir(directoryPath, { recursive: true })
  return directoryPath
}

async function persistLargeOutput(
  cwd: string,
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number,
  interrupted: boolean,
  sandboxMode: BashSandboxMode,
): Promise<{ path: string; sizeBytes: number } | undefined> {
  if (
    stdout.length <= MAX_INLINE_OUTPUT_CHARS &&
    stderr.length <= MAX_INLINE_OUTPUT_CHARS
  ) {
    return undefined
  }

  void cwd
  const toolResultsDir = getToolResultsDir(process.env)
  await mkdir(toolResultsDir, { recursive: true })

  const persistedOutputPath = join(toolResultsDir, `${randomUUID()}.log`)
  const payload = buildPersistedOutputPayload({
    mode: 'foreground',
    cwd,
    command,
    stdout,
    stderr,
    exitCode,
    interrupted,
    sandboxMode,
  })

  await writeFile(persistedOutputPath, payload, 'utf8')
  return {
    path: persistedOutputPath,
    sizeBytes: Buffer.byteLength(payload, 'utf8'),
  }
}

function resolveSandboxMode(
  input: BashToolInput,
  context: { permissionMode: string },
): BashSandboxMode {
  return input.dangerouslyDisableSandbox &&
    context.permissionMode === 'bypass-permissions'
    ? 'danger-full-access'
    : 'restricted'
}

function buildExecutionEnvironment(
  sandboxMode: BashSandboxMode,
  cwd: string,
): NodeJS.ProcessEnv {
  if (sandboxMode === 'danger-full-access') {
    return {
      ...process.env,
      PWD: cwd,
    }
  }

  const env: NodeJS.ProcessEnv = {
    PWD: cwd,
  }
  const allowedKeys = new Set([
    'PATH',
    'HOME',
    'SHELL',
    'TMPDIR',
    'TMP',
    'TEMP',
    'USER',
    'LOGNAME',
    'DCLAW_HOME',
    ...SAFE_ENV_VARS,
  ])

  for (const key of allowedKeys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (
      key.startsWith('DCLAW_') &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      env[key] = value
    }
  }

  return env
}

export const bashTool: Tool<BashToolInput, BashToolOutput> = buildTool({
  name: 'Bash',
  description: 'Execute a shell command.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute.',
      },
      timeout: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_TIMEOUT_MS,
        description: 'Optional timeout in milliseconds.',
      },
      description: {
        type: 'string',
        description: 'Optional short description of why the command is being run.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run the command in the background and return immediately with a task id.',
      },
      dangerouslyDisableSandbox: {
        type: 'boolean',
        description: 'Request unsandboxed execution. Only valid in bypass-permissions mode.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      stdout: { type: 'string' },
      stderr: { type: 'string' },
      stdoutTruncated: { type: 'boolean' },
      stderrTruncated: { type: 'boolean' },
      exitCode: { type: 'integer' },
      interrupted: { type: 'boolean' },
      sandboxMode: {
        type: 'string',
        enum: ['restricted', 'danger-full-access'],
      },
      executionMode: {
        type: 'string',
        enum: ['foreground', 'background'],
      },
      noOutputExpected: { type: 'boolean' },
      dangerouslyDisableSandbox: { type: 'boolean' },
      returnCodeInterpretation: { type: 'string' },
      backgroundTaskId: { type: 'string' },
      persistedOutputPath: { type: 'string' },
      persistedOutputSize: { type: 'integer' },
    },
    required: [
      'command',
      'stdout',
      'stderr',
      'exitCode',
      'interrupted',
      'sandboxMode',
      'executionMode',
    ],
    additionalProperties: false,
  },
  validate(input, context) {
    if (!input.command || input.command.trim().length === 0) {
      return {
        ok: false,
        error: 'Bash requires a non-empty command',
      }
    }

    if (
      input.timeout !== undefined &&
      (!Number.isInteger(input.timeout) ||
        input.timeout < 1 ||
        input.timeout > MAX_TIMEOUT_MS)
    ) {
      return {
        ok: false,
        error: `Bash timeout must be an integer between 1 and ${MAX_TIMEOUT_MS} milliseconds`,
      }
    }

    if (input.dangerouslyDisableSandbox) {
      if (context.permissionMode !== 'bypass-permissions') {
        return {
          ok: false,
          error:
            'Bash dangerouslyDisableSandbox requires permission mode bypass-permissions',
        }
      }

      return { ok: true }
    }

    return { ok: true }
  },
  isReadOnly(input) {
    const classification = classifyBashCommand(input.command)
    return (
      classification.isSearch || classification.isRead || classification.isList
    )
  },
  async call(input, context): Promise<ToolResult<BashToolOutput>> {
    if (
      input.dangerouslyDisableSandbox &&
      context.permissionMode !== 'bypass-permissions'
    ) {
      return {
        ok: false,
        output: {
          command: input.command,
          stdout: '',
          stderr:
            'Bash dangerouslyDisableSandbox requires permission mode bypass-permissions',
          stdoutTruncated: false,
          stderrTruncated: false,
          exitCode: 1,
          interrupted: false,
          sandboxMode: 'restricted',
          executionMode: 'foreground',
          noOutputExpected: false,
          dangerouslyDisableSandbox: false,
        },
        summary:
          input.description ||
          'Rejected unsandboxed Bash request outside bypass-permissions mode',
      }
    }

    const noOutputExpected = isSilentBashCommand(input.command)
    const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
    const sandboxMode = resolveSandboxMode(input, context)
    const environment = buildExecutionEnvironment(sandboxMode, context.cwd)

    if (input.run_in_background) {
      const backgroundTaskId = randomUUID()
      const backgroundTasksDir = await ensureBackgroundTasksDir(context.cwd)
      const persistedOutputPath = join(
        backgroundTasksDir,
        `${backgroundTaskId}.log`,
      )
      await writeFile(
        persistedOutputPath,
        [
          '# dclaw background task',
          `task_id: ${backgroundTaskId}`,
          `cwd: ${context.cwd}`,
          `sandbox_mode: ${sandboxMode}`,
          '',
          '# command',
          input.command,
          '',
          '# output',
          '',
        ].join('\n'),
        'utf8',
      )
      const quotedLogPath = shellQuote(persistedOutputPath)
      const wrappedCommand = [
        `(${input.command}) >> ${quotedLogPath} 2>&1`,
        'status=$?',
        `printf '\\n# dclaw background task complete\\n# exit_code: %s\\n' "$status" >> ${quotedLogPath}`,
        'exit 0',
      ].join('\n')
      const shellPath = process.env.SHELL || '/bin/sh'
      const child = spawn(shellPath, ['-lc', wrappedCommand], {
        cwd: context.cwd,
        detached: true,
        stdio: 'ignore',
        env: environment,
      })

      child.unref()

      return {
        ok: true,
        output: {
          command: input.command,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          exitCode: 0,
          interrupted: false,
          sandboxMode,
          executionMode: 'background',
          noOutputExpected,
          dangerouslyDisableSandbox:
            sandboxMode === 'danger-full-access',
          backgroundTaskId,
          persistedOutputPath,
        },
        summary:
          input.description ||
          `Started background command ${input.command}`,
      }
    }

    try {
      const result = await execAsync(input.command, {
        cwd: context.cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.env.SHELL || '/bin/sh',
        env: environment,
      })
      const persistedOutputPath = await persistLargeOutput(
        context.cwd,
        input.command,
        result.stdout,
        result.stderr,
        0,
        false,
        sandboxMode,
      )
      const truncatedStdout = truncateOutput(result.stdout, MAX_INLINE_OUTPUT_CHARS)
      const truncatedStderr = truncateOutput(result.stderr, MAX_INLINE_OUTPUT_CHARS)

      return {
        ok: true,
        output: {
          command: input.command,
          stdout: truncatedStdout.text,
          stderr: truncatedStderr.text,
          stdoutTruncated: truncatedStdout.wasTruncated,
          stderrTruncated: truncatedStderr.wasTruncated,
          exitCode: 0,
          interrupted: false,
          sandboxMode,
          executionMode: 'foreground',
          noOutputExpected,
          dangerouslyDisableSandbox:
            sandboxMode === 'danger-full-access',
          persistedOutputPath: persistedOutputPath?.path,
          persistedOutputSize: persistedOutputPath?.sizeBytes,
        },
        summary: input.description || `Ran ${input.command}`,
      }
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
        code?: string | number
        killed?: boolean
        signal?: NodeJS.Signals
      }
      const interrupted =
        execError.killed === true || execError.signal === 'SIGTERM'
      const exitCode =
        typeof execError.code === 'number'
          ? execError.code
          : interrupted
            ? 124
            : 1
      const rawStdout = execError.stdout ?? ''
      const rawStderr =
        execError.stderr ??
        (interrupted
          ? `Command timed out after ${timeout}ms`
          : execError.message)
      const persistedOutputPath = await persistLargeOutput(
        context.cwd,
        input.command,
        rawStdout,
        rawStderr,
        exitCode,
        interrupted,
        sandboxMode,
      )
      const truncatedStdout = truncateOutput(rawStdout, MAX_INLINE_OUTPUT_CHARS)
      const truncatedStderr = truncateOutput(rawStderr, MAX_INLINE_OUTPUT_CHARS)

      return {
        ok: false,
        output: {
          command: input.command,
          stdout: truncatedStdout.text,
          stderr: truncatedStderr.text,
          stdoutTruncated: truncatedStdout.wasTruncated,
          stderrTruncated: truncatedStderr.wasTruncated,
          exitCode,
          interrupted,
          sandboxMode,
          executionMode: 'foreground',
          noOutputExpected,
          dangerouslyDisableSandbox:
            sandboxMode === 'danger-full-access',
          returnCodeInterpretation:
            interrupted && exitCode === 124 ? 'Command timed out' : undefined,
          persistedOutputPath: persistedOutputPath?.path,
          persistedOutputSize: persistedOutputPath?.sizeBytes,
        },
        summary: input.description || `Ran ${input.command}`,
      }
    }
  },
})
