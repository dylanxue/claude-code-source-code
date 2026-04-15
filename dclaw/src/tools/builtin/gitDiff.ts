import { execFile } from 'node:child_process'
import { basename, dirname, relative } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ToolUseGitDiff = {
  filename: string
  status: 'modified' | 'added'
  additions: number
  deletions: number
  changes: number
  patch: string
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: 2 * 1024 * 1024,
  })
}

function countEffectiveLines(text: string): number {
  return text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line, index, all) => !(index === all.length - 1 && line === ''))
    .length
}

function buildSyntheticPatch(
  filename: string,
  originalFile: string | null,
  content: string,
): ToolUseGitDiff {
  const oldLines = (originalFile ?? '').replaceAll('\r\n', '\n').split('\n')
  const newLines = content.replaceAll('\r\n', '\n').split('\n')
  const effectiveNewLines = newLines.filter((line, index, all) => {
    return !(index === all.length - 1 && line === '')
  })
  const effectiveOldLines = oldLines.filter((line, index, all) => {
    return !(index === all.length - 1 && line === '')
  })

  const patchLines =
    originalFile === null
      ? [
          `diff --git a/${filename} b/${filename}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${filename}`,
          ...newLines.map(line => `+${line}`),
        ]
      : [
          `diff --git a/${filename} b/${filename}`,
          `--- a/${filename}`,
          `+++ b/${filename}`,
          ...oldLines.map(line => `-${line}`),
          ...newLines.map(line => `+${line}`),
        ]

  const additions = countEffectiveLines(content)
  const deletions = countEffectiveLines(originalFile ?? '')

  return {
    filename,
    status: originalFile === null ? 'added' : 'modified',
    additions,
    deletions: originalFile === null ? 0 : deletions,
    changes: additions + (originalFile === null ? 0 : deletions),
    patch: patchLines.join('\n'),
  }
}

export async function fetchSingleFileGitDiff(
  filePath: string,
  originalFile: string | null,
  content: string,
): Promise<ToolUseGitDiff | undefined> {
  try {
    const gitCwd = dirname(filePath)
    const { stdout: gitRootStdout } = await runGit(gitCwd, [
      'rev-parse',
      '--show-toplevel',
    ])
    const gitRoot = gitRootStdout.trim()
    const relativeName =
      gitRoot.length > 0 ? relative(gitRoot, filePath) : basename(filePath)

    try {
      const { stdout: patch } = await runGit(gitCwd, [
        '--no-pager',
        'diff',
        '--no-ext-diff',
        '--no-color',
        '--',
        filePath,
      ])

      if (patch.trim().length > 0) {
        const { stdout: numstat } = await runGit(gitCwd, [
          '--no-pager',
          'diff',
          '--no-ext-diff',
          '--no-color',
          '--numstat',
          '--',
          filePath,
        ])
        const [firstLine = '0\t0'] = numstat.trim().split('\n')
        const [addedRaw = '0', removedRaw = '0'] = firstLine.split('\t')
        const additions = Number.parseInt(addedRaw, 10) || 0
        const deletions = Number.parseInt(removedRaw, 10) || 0

        return {
          filename: relativeName,
          status: 'modified',
          additions,
          deletions,
          changes: additions + deletions,
          patch,
        }
      }
    } catch {
      // Fall through to synthetic diff below.
    }

    return buildSyntheticPatch(relativeName, originalFile, content)
  } catch {
    return undefined
  }
}
