import { homedir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

export function toAbsoluteToolPath(inputPath: string): string {
  if (inputPath === '~') {
    return homedir()
  }

  if (inputPath.startsWith('~/')) {
    return resolve(homedir(), inputPath.slice(2))
  }

  return inputPath
}

export function isAbsoluteToolPath(inputPath: string): boolean {
  return isAbsolute(toAbsoluteToolPath(inputPath))
}

export function toDisplayPath(inputPath: string, cwd: string): string {
  const relativePath = relative(cwd, inputPath)
  if (
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  ) {
    return relativePath
  }

  return inputPath
}
