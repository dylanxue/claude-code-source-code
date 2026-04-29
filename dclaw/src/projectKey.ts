import { resolve } from 'node:path'

const MAX_SANITIZED_LENGTH = 200

function simpleHash(value: string): string {
  let hash = 5381
  for (const char of value) {
    hash = (hash * 33) ^ char.charCodeAt(0)
  }
  return Math.abs(hash).toString(36)
}

export function sanitizeProjectKey(workspaceRoot: string): string {
  const normalized = resolve(workspaceRoot).normalize('NFC')
  const sanitized = normalized.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }

  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${simpleHash(normalized)}`
}
