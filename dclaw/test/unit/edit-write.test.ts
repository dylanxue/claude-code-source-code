import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { editTool } from '../../src/tools/builtin/edit.js'
import { readFileTool } from '../../src/tools/builtin/readFile.js'
import { writeTool } from '../../src/tools/builtin/write.js'
import { createToolContext } from '../helpers/toolContext.js'

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

test('Edit requires a full read before mutating existing files', async () => {
  const dir = await createTempDir('dclaw-edit-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'one\ntwo\n', 'utf8')
    const validation = await editTool.validate?.(
      {
        file_path: filePath,
        old_string: 'two',
        new_string: 'TWO',
      },
      createToolContext(),
    )

    assert.deepEqual(validation, {
      ok: false,
      error: 'File has not been fully read yet. Use Read first before Edit.',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Edit returns structuredPatch after a full read', async () => {
  const dir = await createTempDir('dclaw-edit-patch-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')
    await readFileTool.call({ file_path: filePath }, context)
    const result = await editTool.call(
      {
        file_path: filePath,
        old_string: 'two',
        new_string: 'TWO',
      },
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.oldString, 'two')
    assert.equal(result.output.newString, 'TWO')
    assert.equal(result.output.userModified, false)
    assert.equal(result.output.didWrite, true)
    assert.equal(result.output.replaceAll, false)
    assert.equal(result.output.structuredPatch.length, 1)
    assert.deepEqual(result.output.structuredPatch[0]?.lines, [
      ' one',
      '-two',
      '+TWO',
      ' three',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Edit validation requires replace_all when the target appears multiple times', async () => {
  const dir = await createTempDir('dclaw-edit-multi-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'two\ntwo\n', 'utf8')
    await readFileTool.call({ file_path: filePath }, context)
    const validation = await editTool.validate?.(
      {
        file_path: filePath,
        old_string: 'two',
        new_string: 'TWO',
      },
      context,
    )

    assert.deepEqual(validation, {
      ok: false,
      error:
        'Found 2 matches of the string to replace, but replace_all is false. Set replace_all to true or provide more context to identify a single occurrence.',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Edit replace_all updates every match', async () => {
  const dir = await createTempDir('dclaw-edit-replace-all-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'two\ntwo\n', 'utf8')
    await readFileTool.call({ file_path: filePath }, context)
    const result = await editTool.call(
      {
        file_path: filePath,
        old_string: 'two',
        new_string: 'TWO',
        replace_all: true,
      },
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.replaced, 2)
    assert.equal(result.output.replaceAll, true)
    assert.equal(await readFile(filePath, 'utf8'), 'TWO\nTWO\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Edit call rejects when the file was not fully read first', async () => {
  const dir = await createTempDir('dclaw-edit-call-no-read-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'one\ntwo\n', 'utf8')
    await assert.rejects(
      () =>
        editTool.call(
          {
            file_path: filePath,
            old_string: 'two',
            new_string: 'TWO',
          },
          createToolContext(),
        ),
      /File has not been fully read yet. Use Read first before Edit\./,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Edit call rejects when the file changed after it was read', async () => {
  const dir = await createTempDir('dclaw-edit-call-stale-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'one\ntwo\n', 'utf8')
    await readFileTool.call({ file_path: filePath }, context)
    await writeFile(filePath, 'one\nchanged\n', 'utf8')
    const bumpedTime = new Date(Date.now() + 2_000)
    await utimes(filePath, bumpedTime, bumpedTime)

    await assert.rejects(
      () =>
        editTool.call(
          {
            file_path: filePath,
            old_string: 'two',
            new_string: 'TWO',
          },
          context,
        ),
      /File has been modified since it was read. Use Read again before Edit\./,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Write returns structuredPatch when updating an existing file', async () => {
  const dir = await createTempDir('dclaw-write-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'old\ntext\n', 'utf8')
    await readFileTool.call({ file_path: filePath }, context)
    const result = await writeTool.call(
      {
        file_path: filePath,
        content: 'new\ntext\n',
      },
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.type, 'update')
    assert.equal(result.output.didWrite, true)
    assert.equal(result.output.userModified, false)
    assert.equal(result.output.structuredPatch.length, 1)
    assert.deepEqual(result.output.structuredPatch[0]?.lines, [
      '-old',
      '+new',
      ' text',
    ])
    assert.equal(await readFile(filePath, 'utf8'), 'new\ntext\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Write returns noop when content is unchanged', async () => {
  const dir = await createTempDir('dclaw-write-noop-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'same\ntext\n', 'utf8')
    await readFileTool.call({ file_path: filePath }, context)
    const result = await writeTool.call(
      {
        file_path: filePath,
        content: 'same\ntext\n',
      },
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.type, 'noop')
    assert.equal(result.output.didWrite, false)
    assert.equal(result.output.userModified, false)
    assert.deepEqual(result.output.structuredPatch, [])
    assert.equal(await readFile(filePath, 'utf8'), 'same\ntext\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Write validation rejects partial reads for existing files', async () => {
  const dir = await createTempDir('dclaw-write-partial-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'old\ntext\n', 'utf8')
    await readFileTool.call({ file_path: filePath, limit: 1 }, context)
    const validation = await writeTool.validate?.(
      {
        file_path: filePath,
        content: 'new\ntext\n',
      },
      context,
    )

    assert.deepEqual(validation, {
      ok: false,
      error: 'File has not been fully read yet. Use Read first before Write.',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Write accepts a limited read when it reached EOF from the first line', async () => {
  const dir = await createTempDir('dclaw-write-full-range-')
  const filePath = join(dir, 'plan.md')
  const context = createToolContext()

  try {
    await writeFile(filePath, '# Plan\n\n- old\n', 'utf8')
    await readFileTool.call(
      { file_path: filePath, offset: 1, limit: 1000 },
      context,
    )
    const result = await writeTool.call(
      {
        file_path: filePath,
        content: '# Plan\n\n- updated\n',
      },
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.didWrite, true)
    assert.equal(await readFile(filePath, 'utf8'), '# Plan\n\n- updated\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Write call rejects when the file was not fully read first', async () => {
  const dir = await createTempDir('dclaw-write-call-no-read-')
  const filePath = join(dir, 'sample.txt')

  try {
    await writeFile(filePath, 'old\ntext\n', 'utf8')
    await assert.rejects(
      () =>
        writeTool.call(
          {
            file_path: filePath,
            content: 'new\ntext\n',
          },
          createToolContext(),
        ),
      /File has not been fully read yet. Use Read first before Write\./,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Write call rejects when the file changed after it was read', async () => {
  const dir = await createTempDir('dclaw-write-call-stale-')
  const filePath = join(dir, 'sample.txt')
  const context = createToolContext()

  try {
    await writeFile(filePath, 'old\ntext\n', 'utf8')
    await readFileTool.call({ file_path: filePath }, context)
    await writeFile(filePath, 'changed\ntext\n', 'utf8')
    const bumpedTime = new Date(Date.now() + 2_000)
    await utimes(filePath, bumpedTime, bumpedTime)

    await assert.rejects(
      () =>
        writeTool.call(
          {
            file_path: filePath,
            content: 'new\ntext\n',
          },
          context,
        ),
      /File has been modified since it was read. Use Read again before Write\./,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
