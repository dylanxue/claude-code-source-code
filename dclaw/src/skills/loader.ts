import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDclawHomeDir } from '../session/paths.js'
import type {
  LoadedSkill,
  SkillFrontmatter,
  SkillSource,
} from './types.js'

const FRONTMATTER_DELIMITER = '---'
const MARKDOWN_EXTENSION = '.md'
const PROJECT_SKILLS_DIRECTORY = join('.dclaw', 'skills')
const USER_SKILLS_DIRECTORY = 'skills'

export const DEFAULT_BUILTIN_SKILLS_DIR = fileURLToPath(
  new URL('./builtin', import.meta.url),
)

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed) as string
      } catch {
        return trimmed.slice(1, -1)
      }
    }

    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseFrontmatterBlock(
  block: string,
): Partial<Record<keyof SkillFrontmatter, string>> {
  const parsed: Partial<Record<keyof SkillFrontmatter, string>> = {}

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim() as keyof SkillFrontmatter
    const value = stripQuotes(line.slice(separatorIndex + 1))

    if (key === 'name' || key === 'description' || key === 'context') {
      parsed[key] = value
    }
  }

  return parsed
}

function normalizeSkillFrontmatter(
  value: Partial<Record<keyof SkillFrontmatter, string>>,
): SkillFrontmatter | null {
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    typeof value.description !== 'string' ||
    value.description.trim().length === 0
  ) {
    return null
  }

  return {
    name: value.name.trim(),
    description: value.description.trim(),
    ...(value.context === 'fork' || value.context === 'inline'
      ? { context: value.context }
      : {}),
  }
}

export function parseSkillDocument(content: string): {
  frontmatter: SkillFrontmatter | null
  body: string
} {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return {
      frontmatter: null,
      body: normalized,
    }
  }

  const closingDelimiter = `\n${FRONTMATTER_DELIMITER}\n`
  const closingIndex = normalized.indexOf(closingDelimiter)
  if (closingIndex === -1) {
    return {
      frontmatter: null,
      body: normalized,
    }
  }

  const block = normalized.slice(
    FRONTMATTER_DELIMITER.length + 1,
    closingIndex,
  )
  const body = normalized
    .slice(closingIndex + closingDelimiter.length)
    .replace(/^\n/, '')

  return {
    frontmatter: normalizeSkillFrontmatter(parseFrontmatterBlock(block)),
    body,
  }
}

async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function listMarkdownFiles(path: string): Promise<string[]> {
  const entries = await readDirectoryEntries(path)
  const sorted = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name),
  )
  const files: string[] = []

  for (const entry of sorted) {
    const fullPath = join(path, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)))
      continue
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === MARKDOWN_EXTENSION) {
      files.push(resolve(fullPath))
    }
  }

  return files
}

async function loadSkillFile(
  path: string,
  source: SkillSource,
): Promise<LoadedSkill | null> {
  try {
    const document = parseSkillDocument(await readFile(path, 'utf8'))
    const prompt = document.body.trim()

    if (!document.frontmatter || prompt.length === 0) {
      return null
    }

    return {
      name: document.frontmatter.name,
      description: document.frontmatter.description,
      source,
      prompt,
      context: document.frontmatter.context,
      path: resolve(path),
    }
  } catch {
    return null
  }
}

async function loadSkillsFromDirectory(
  path: string,
  source: SkillSource,
): Promise<LoadedSkill[]> {
  const files = await listMarkdownFiles(path)
  const skills: LoadedSkill[] = []

  for (const filePath of files) {
    const skill = await loadSkillFile(filePath, source)
    if (skill) {
      skills.push(skill)
    }
  }

  return skills
}

function listAncestorDirectories(cwd: string): string[] {
  const directories: string[] = []
  let current = resolve(cwd)

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

export async function findProjectSkillDirectories(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const directories = listAncestorDirectories(cwd)
  const found: string[] = []
  const userSkillsDirectory = resolve(getDclawHomeDir(env), USER_SKILLS_DIRECTORY)

  for (const directory of directories) {
    const candidate = join(directory, PROJECT_SKILLS_DIRECTORY)
    const resolvedCandidate = resolve(candidate)
    if (
      resolvedCandidate !== userSkillsDirectory &&
      await isDirectory(resolvedCandidate)
    ) {
      found.push(resolvedCandidate)
    }
  }

  return found
}

export async function loadBuiltinSkills(
  builtinSkillsDir: string = DEFAULT_BUILTIN_SKILLS_DIR,
): Promise<LoadedSkill[]> {
  return loadSkillsFromDirectory(resolve(builtinSkillsDir), 'builtin')
}

export async function loadUserSkills(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedSkill[]> {
  return loadSkillsFromDirectory(
    resolve(getDclawHomeDir(env), USER_SKILLS_DIRECTORY),
    'user',
  )
}

export async function loadProjectSkills(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedSkill[]> {
  const directories = await findProjectSkillDirectories(cwd, env)
  const skills: LoadedSkill[] = []

  for (const directory of directories) {
    skills.push(...(await loadSkillsFromDirectory(directory, 'project')))
  }

  return skills
}

export async function loadSkills(input: {
  cwd: string
  builtinSkillsDir?: string
  env?: NodeJS.ProcessEnv
}): Promise<LoadedSkill[]> {
  const builtinSkills = await loadBuiltinSkills(input.builtinSkillsDir)
  const userSkills = await loadUserSkills(input.env)
  const projectSkills = await loadProjectSkills(input.cwd, input.env)

  return [...builtinSkills, ...userSkills, ...projectSkills]
}
