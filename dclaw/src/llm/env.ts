import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return null
  }

  const exportPrefix = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length)
    : trimmed
  const separatorIndex = exportPrefix.indexOf('=')
  if (separatorIndex <= 0) {
    return null
  }

  const key = exportPrefix.slice(0, separatorIndex).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null
  }

  let rawValue = exportPrefix.slice(separatorIndex + 1).trim()
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    rawValue = rawValue.slice(1, -1)
  } else {
    const commentIndex = rawValue.indexOf(' #')
    if (commentIndex >= 0) {
      rawValue = rawValue.slice(0, commentIndex).trimEnd()
    }
  }

  rawValue = rawValue
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')

  return { key, value: rawValue }
}

export function loadEnvFiles(baseDir: string, env: NodeJS.ProcessEnv = process.env): void {
  const originalKeys = new Set(Object.keys(env))
  const loadedKeys = new Set<string>()
  const filePaths = [
    resolve(baseDir, '.env'),
    resolve(baseDir, '.env.local'),
  ]

  for (const filePath of filePaths) {
    if (!existsSync(filePath)) {
      continue
    }

    const content = readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseEnvLine(line)
      if (!parsed) {
        continue
      }

      if (!originalKeys.has(parsed.key) || loadedKeys.has(parsed.key)) {
        env[parsed.key] = parsed.value
        loadedKeys.add(parsed.key)
      }
    }
  }
}
