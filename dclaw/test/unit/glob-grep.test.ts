import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { globTool } from '../../src/tools/builtin/glob.js'
import { grepTool } from '../../src/tools/builtin/grep.js'
import { createToolContext } from '../helpers/toolContext.js'

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

test('Glob truncates results after 100 files', async () => {
  const dir = await createTempDir('dclaw-glob-')

  try {
    for (let index = 0; index < 105; index += 1) {
      await writeFile(join(dir, `file-${index}.md`), `# ${index}\n`, 'utf8')
    }

    const result = await globTool.call(
      {
        pattern: '*.md',
        path: dir,
      },
      createToolContext({ cwd: dir }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.numFiles, 100)
    assert.equal(result.output.truncated, true)
    assert.equal(result.output.filenames.length, 100)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Glob validation rejects non-directory paths', async () => {
  const dir = await createTempDir('dclaw-glob-validate-')
  const filePath = join(dir, 'file.txt')

  try {
    await writeFile(filePath, 'hello', 'utf8')
    const validation = await globTool.validate?.(
      {
        pattern: '*.txt',
        path: filePath,
      },
      createToolContext(),
    )

    assert.deepEqual(validation, {
      ok: false,
      error: 'Glob path must point to a directory',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Grep defaults to files_with_matches mode', async () => {
  const dir = await createTempDir('dclaw-grep-default-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'alpha\nbeta\nalpha\n', 'utf8')
    const result = await grepTool.call(
      {
        pattern: 'alpha',
        path: filePath,
      },
      createToolContext({ cwd: dir }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.mode, 'files_with_matches')
    assert.deepEqual(result.output.filenames, ['sample.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Grep applies default head_limit in content mode', async () => {
  const dir = await createTempDir('dclaw-grep-limit-')
  const filePath = join(dir, 'sample.txt')
  const lines = Array.from({ length: 300 }, (_, index) => `match-${index}`).join(
    '\n',
  )

  try {
    await writeFile(filePath, `${lines}\n`, 'utf8')
    const result = await grepTool.call(
      {
        pattern: 'match-',
        path: filePath,
        output_mode: 'content',
      },
      createToolContext({ cwd: dir }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.mode, 'content')
    assert.equal(result.output.appliedLimit, 250)
    assert.equal(result.output.numLines, 250)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Grep supports content mode without line numbers', async () => {
  const dir = await createTempDir('dclaw-grep-noline-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'alpha\nbeta\n', 'utf8')
    const result = await grepTool.call(
      {
        pattern: 'alpha',
        path: filePath,
        output_mode: 'content',
        '-n': false,
      },
      createToolContext({ cwd: dir }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.content, 'sample.txt:alpha')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Grep validation rejects negative head_limit', async () => {
  const validation = await grepTool.validate?.(
    {
      pattern: 'alpha',
      head_limit: -1,
    },
    createToolContext(),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'Grep head_limit must be an integer greater than or equal to 0',
  })
})
