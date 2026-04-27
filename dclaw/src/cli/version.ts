import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function readCliVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkgPath = resolve(here, '../../package.json')
  const text = await readFile(pkgPath, 'utf8')
  const parsed = JSON.parse(text) as { version?: string }
  return parsed.version ?? '0.0.0'
}
