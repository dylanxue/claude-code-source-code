import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileTool } from '../../src/tools/builtin/readFile.js'
import { createToolContext } from '../helpers/toolContext.js'

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

test('Read description and schema nudge callers toward targeted large-file reads', () => {
  assert.match(
    readFileTool.description,
    /Read the whole file when it is reasonably small/,
  )
  assert.match(readFileTool.description, /use offset and limit/i)
  assert.match(readFileTool.description, /search for specific content first/i)

  const properties = readFileTool.inputSchema.properties as
    | Record<string, { description?: string }>
    | undefined

  assert.match(properties?.offset?.description ?? '', /specific section/i)
  assert.match(properties?.limit?.description ?? '', /larger file/i)
})

test('Read returns isPartial for ranged reads', async () => {
  const dir = await createTempDir('dclaw-read-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'a\nb\nc\n', 'utf8')
    const result = await readFileTool.call(
      { file_path: filePath, offset: 2, limit: 1 },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.isPartial, true)
    assert.equal(result.output.didReadToEnd, false)
    assert.equal(result.output.file.content, 'b')
    assert.equal(result.output.file.startLine, 2)
    assert.equal(result.output.file.endLine, 2)
    assert.equal(result.output.file.totalLines, 3)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns warning for empty files', async () => {
  const dir = await createTempDir('dclaw-read-empty-')
  const filePath = join(dir, 'empty.txt')

  try {
    await writeFile(filePath, '', 'utf8')
    const result = await readFileTool.call(
      { file_path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.file.numLines, 0)
    assert.equal(result.output.file.endLine, 0)
    assert.equal(result.output.didReadToEnd, true)
    assert.equal(result.output.warning, 'The file exists but is empty.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read returns warning when offset is beyond end of file', async () => {
  const dir = await createTempDir('dclaw-read-range-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'a\nb\n', 'utf8')
    const result = await readFileTool.call(
      { file_path: filePath, offset: 10 },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    assert.match(result.output.warning ?? '', /offset \(10\) is beyond the end/)
    assert.equal(result.output.file.content, '')
    assert.equal(result.output.file.endLine, 9)
    assert.equal(result.output.didReadToEnd, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read validation rejects directory paths', async () => {
  const dir = await createTempDir('dclaw-read-dir-')
  const subdir = join(dir, 'subdir')

  try {
    await mkdir(subdir)
    const validation = await readFileTool.validate?.(
      { file_path: subdir },
      createToolContext(),
    )

    assert.deepEqual(validation, {
      ok: false,
      error: 'Read can only read regular files',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read validation rejects missing files', async () => {
  const missingPath = join(
    tmpdir(),
    `dclaw-missing-${Date.now()}`,
    'missing.txt',
  )

  const validation = await readFileTool.validate?.(
    { file_path: missingPath },
    createToolContext(),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: `File does not exist: ${missingPath}`,
  })
})

test('Read accepts path as an alias for file_path', async () => {
  const dir = await createTempDir('dclaw-read-path-alias-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'alias works\n', 'utf8')
    const validation = await readFileTool.validate?.(
      { path: filePath },
      createToolContext(),
    )

    assert.deepEqual(validation, { ok: true })

    const result = await readFileTool.call(
      { path: filePath },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.file.filePath, filePath)
    assert.equal(result.output.file.content, 'alias works')
    assert.equal(result.output.file.endLine, 1)
    assert.equal(result.output.didReadToEnd, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read rejects oversized full-file reads without an explicit limit', async () => {
  const dir = await createTempDir('dclaw-read-large-')
  const filePath = join(dir, 'large.txt')

  try {
    await writeFile(filePath, 'x'.repeat(300_000), 'utf8')

    await assert.rejects(
      () => readFileTool.call({ file_path: filePath }, createToolContext()),
      /Use offset and limit to read specific portions of the file, or search for specific content instead of reading the whole file/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Read still allows oversized files when the caller provides a limit', async () => {
  const dir = await createTempDir('dclaw-read-large-limited-')
  const filePath = join(dir, 'large.txt')

  try {
    await writeFile(filePath, `${'x'.repeat(300_000)}\nsecond line\n`, 'utf8')
    const result = await readFileTool.call(
      {
        file_path: filePath,
        limit: 1,
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.isPartial, true)
    assert.equal(result.output.didReadToEnd, false)
    assert.equal(result.output.file.numLines, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
