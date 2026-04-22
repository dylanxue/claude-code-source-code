import { access, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { getDclawHomeDir } from '../session/paths.js'
import { createTextMessage, type Message } from '../types/message.js'

export type DclawMdSource = 'user' | 'project' | 'local' | 'rules'

export type DclawMdEntry = {
  source: DclawMdSource
  path: string
  content: string
}

const MAX_CLAW_MD_CHARS = 20_000
const ALLOWED_INCLUDE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.text',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.scala',
  '.c',
  '.cpp',
  '.cc',
  '.h',
  '.hpp',
  '.cs',
  '.swift',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  '.sql',
  '.graphql',
  '.gql',
  '.proto',
  '.vue',
  '.svelte',
  '.astro',
  '.ejs',
  '.hbs',
  '.pug',
  '.jade',
  '.php',
  '.pl',
  '.lua',
  '.r',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.clj',
  '.edn',
  '.hs',
  '.elm',
  '.ml',
  '.f',
  '.f90',
  '.cmake',
  '.make',
  '.makefile',
  '.gradle',
  '.sbt',
  '.rst',
  '.adoc',
  '.asciidoc',
  '.org',
  '.tex',
  '.latex',
  '.lock',
  '.log',
  '.diff',
  '.patch',
])

type LoadState = {
  loadedPaths: Set<string>
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    await access(path)
    const raw = await readFile(path, 'utf8')
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return null
    }
    return trimmed.slice(0, MAX_CLAW_MD_CHARS)
  } catch {
    return null
  }
}

function normalizePath(path: string): string {
  return resolve(path)
}

function isAllowedIncludePath(path: string): boolean {
  const extension = extname(path).toLowerCase()
  return extension.length === 0 || ALLOWED_INCLUDE_EXTENSIONS.has(extension)
}

function resolveIncludePath(reference: string, fromPath: string): string | null {
  if (reference.startsWith('~/')) {
    return join(homedir(), reference.slice(2))
  }
  if (isAbsolute(reference)) {
    return reference
  }
  if (reference.startsWith('./') || reference.startsWith('../')) {
    return resolve(dirname(fromPath), reference)
  }
  return resolve(dirname(fromPath), reference)
}

function stripHtmlCommentsForIncludeParsing(content: string): string {
  let inCodeBlock = false
  let inHtmlComment = false
  const outputLines: string[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      outputLines.push(line)
      continue
    }

    if (inCodeBlock) {
      outputLines.push(line)
      continue
    }

    let current = line

    if (inHtmlComment) {
      const endIndex = current.indexOf('-->')
      if (endIndex === -1) {
        outputLines.push('')
        continue
      }
      current = current.slice(endIndex + 3)
      inHtmlComment = false
    }

    while (true) {
      const startIndex = current.indexOf('<!--')
      if (startIndex === -1) {
        break
      }
      const endIndex = current.indexOf('-->', startIndex + 4)
      if (endIndex === -1) {
        current = current.slice(0, startIndex)
        inHtmlComment = true
        break
      }
      current = current.slice(0, startIndex) + current.slice(endIndex + 3)
    }

    outputLines.push(current)
  }

  return outputLines.join('\n')
}

function extractIncludes(content: string): string[] {
  const includeReferences: string[] = []
  const cleaned = stripHtmlCommentsForIncludeParsing(content)
  const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
  let inCodeBlock = false

  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) {
      continue
    }

    let match: RegExpExecArray | null
    while ((match = includeRegex.exec(line)) !== null) {
      let reference = match[1]
      if (!reference) {
        continue
      }

      reference = reference.replace(/\\ /g, ' ')
      const hashIndex = reference.indexOf('#')
      if (hashIndex !== -1) {
        reference = reference.slice(0, hashIndex)
      }

      reference = reference.trim()
      if (reference.length > 0) {
        includeReferences.push(reference)
      }
    }
  }

  return includeReferences
}

async function loadEntryWithIncludes(
  source: DclawMdSource,
  path: string,
  state: LoadState,
): Promise<DclawMdEntry[]> {
  const normalizedPath = normalizePath(path)
  if (state.loadedPaths.has(normalizedPath)) {
    return []
  }

  const content = await readIfExists(path)
  if (!content) {
    return []
  }

  state.loadedPaths.add(normalizedPath)
  const includeReferences = extractIncludes(content)
  const includedEntries: DclawMdEntry[] = []

  for (const reference of includeReferences) {
    const resolved = resolveIncludePath(reference, normalizedPath)
    if (!resolved || !isAllowedIncludePath(resolved)) {
      continue
    }
    const nestedEntries = await loadEntryWithIncludes(source, resolved, state)
    includedEntries.push(...nestedEntries)
  }

  const trimmedContent = content.trim()
  if (trimmedContent.length === 0) {
    return includedEntries
  }

  return [
    ...includedEntries,
    {
      source,
      path: normalizedPath,
      content: trimmedContent,
    },
  ]
}

function listDirectoriesFromRootToCwd(cwd: string): string[] {
  const resolvedCwd = resolve(cwd)
  const directories: string[] = []

  let current = resolvedCwd
  while (true) {
    directories.push(current)
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return directories.reverse()
}

async function loadRulesEntries(
  dir: string,
  state: LoadState,
): Promise<DclawMdEntry[]> {
  const rulesDir = join(dir, '.dclaw', 'rules')

  try {
    const entries = await readdir(rulesDir, { withFileTypes: true })
    const markdownFiles = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name)
      .sort()

    const loaded = await Promise.all(
      markdownFiles.map(filename =>
        loadEntryWithIncludes('rules', join(rulesDir, filename), state),
      ),
    )

    return loaded.flat()
  } catch {
    return []
  }
}

async function loadEntriesForDirectory(
  dir: string,
  state: LoadState,
): Promise<DclawMdEntry[]> {
  const [projectEntry, dotClaudeEntry, localEntry, rulesEntries] =
    await Promise.all([
      loadEntryWithIncludes('project', join(dir, 'DCLAW.md'), state),
      loadEntryWithIncludes('project', join(dir, '.dclaw', 'DCLAW.md'), state),
      loadEntryWithIncludes('local', join(dir, 'DCLAW.local.md'), state),
      loadRulesEntries(dir, state),
    ])

  return [
    ...projectEntry,
    ...dotClaudeEntry,
    ...rulesEntries,
    ...localEntry,
  ]
}

export async function loadDclawMdEntries(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DclawMdEntry[]> {
  const state: LoadState = { loadedPaths: new Set() }
  const userEntry = await loadEntryWithIncludes(
    'user',
    join(getDclawHomeDir(env), 'DCLAW.md'),
    state,
  )
  const directories = listDirectoriesFromRootToCwd(cwd)
  const nestedEntries = await Promise.all(
    directories.map(dir => loadEntriesForDirectory(dir, state)),
  )

  return [
    ...userEntry,
    ...nestedEntries.flat(),
  ]
}

export function formatDclawMdLoadOrder(entries: DclawMdEntry[]): string[] {
  if (entries.length === 0) {
    return []
  }

  return [
    'dclaw.md load order:',
    ...entries.map(entry => `- [${entry.source}] ${entry.path}`),
  ]
}

export function buildDclawMdReminderText(
  entries: DclawMdEntry[],
): string | null {
  if (entries.length === 0) {
    return null
  }

  const blocks = entries.map(entry =>
    [
      `## [${entry.source}] ${entry.path}`,
      entry.content,
    ].join('\n'),
  )

  return [
    "As you answer the user's questions, you can use the following context:",
    '# DCLAW.md',
    ...blocks,
    '',
    'IMPORTANT: this context may or may not be relevant to the current task. You should not respond to this context unless it is highly relevant to the task.',
  ].join('\n')
}

export function createDclawMdReminderMessage(
  entries: DclawMdEntry[],
): Message | null {
  const text = buildDclawMdReminderText(entries)
  if (!text) {
    return null
  }

  return createTextMessage('user', `<system-reminder>\n${text}\n</system-reminder>`)
}
