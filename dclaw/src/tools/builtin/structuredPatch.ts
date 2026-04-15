export type StructuredPatchHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

const CONTEXT_LINES = 3

function splitLogicalLines(text: string): string[] {
  const normalized = text.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') {
    return lines.slice(0, -1)
  }
  return lines
}

export function createStructuredPatch(
  oldContent: string,
  newContent: string,
): StructuredPatchHunk[] {
  if (oldContent === newContent) {
    return []
  }

  const oldLines = splitLogicalLines(oldContent)
  const newLines = splitLogicalLines(newContent)

  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const beforeContextStart = Math.max(0, prefix - CONTEXT_LINES)
  const oldChangedEnd = oldLines.length - suffix
  const newChangedEnd = newLines.length - suffix
  const afterContextEnd = Math.min(oldLines.length, oldChangedEnd + CONTEXT_LINES)

  const beforeContext = oldLines.slice(beforeContextStart, prefix)
  const removedLines = oldLines.slice(prefix, oldChangedEnd)
  const addedLines = newLines.slice(prefix, newChangedEnd)
  const afterContext = oldLines.slice(oldChangedEnd, afterContextEnd)

  return [
    {
      oldStart: beforeContextStart + 1,
      oldLines: beforeContext.length + removedLines.length + afterContext.length,
      newStart: beforeContextStart + 1,
      newLines: beforeContext.length + addedLines.length + afterContext.length,
      lines: [
        ...beforeContext.map(line => ` ${line}`),
        ...removedLines.map(line => `-${line}`),
        ...addedLines.map(line => `+${line}`),
        ...afterContext.map(line => ` ${line}`),
      ],
    },
  ]
}
