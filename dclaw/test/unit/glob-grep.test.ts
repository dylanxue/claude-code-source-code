import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { globTool } from '../../src/tools/builtin/glob.js'
import {
  collectFiles,
  fallbackGrep,
} from '../../src/tools/builtin/fileSearch.js'
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
    assert.equal(result.output.totalFiles, 105)
    assert.equal(result.output.truncated, true)
    assert.equal(result.output.appliedLimit, 100)
    assert.equal(result.output.searchRoot, '.')
    assert.equal(result.output.engine, 'ripgrep')
    assert.ok(result.output.durationMs >= 0)
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

test('Glob validation rejects missing paths without throwing', async () => {
  const dir = await createTempDir('dclaw-glob-missing-')
  const missingPath = join(dir, 'missing-tests')

  try {
    const validation = await globTool.validate?.(
      {
        pattern: '**/*.mjs',
        path: missingPath,
      },
      createToolContext(),
    )

    assert.deepEqual(validation, {
      ok: false,
      error: `Glob path does not exist: ${missingPath}`,
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
    assert.equal(result.output.totalFiles, 1)
    assert.equal(result.output.searchRoot, 'sample.txt')
    assert.equal(result.output.engine, 'ripgrep')
    assert.ok(result.output.durationMs >= 0)
    assert.equal(result.output.truncated, false)
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
    assert.equal(result.output.totalLines, 300)
    assert.equal(result.output.searchRoot, 'sample.txt')
    assert.equal(result.output.engine, 'ripgrep')
    assert.ok(result.output.durationMs >= 0)
    assert.equal(result.output.truncated, true)
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
    assert.equal(result.output.searchRoot, 'sample.txt')
    assert.equal(result.output.engine, 'ripgrep')
    assert.ok(result.output.durationMs >= 0)
    assert.equal(result.output.truncated, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Grep validation rejects missing paths without throwing', async () => {
  const dir = await createTempDir('dclaw-grep-missing-')
  const missingPath = join(dir, 'missing-tests')

  try {
    const validation = await grepTool.validate?.(
      {
        pattern: 'needle',
        path: missingPath,
      },
      createToolContext(),
    )

    assert.deepEqual(validation, {
      ok: false,
      error: `Grep path does not exist: ${missingPath}`,
    })
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

test('Grep excludes node_modules by default when searching a project root', async () => {
  const dir = await createTempDir('dclaw-grep-exclude-')
  const appDir = join(dir, 'app')
  const nodeModulesDir = join(appDir, 'node_modules', 'pkg')

  try {
    await mkdir(nodeModulesDir, { recursive: true })
    await writeFile(join(appDir, 'src.txt'), 'needle in app\n', 'utf8')
    await writeFile(join(nodeModulesDir, 'index.txt'), 'needle in package\n', 'utf8')

    const result = await grepTool.call(
      {
        pattern: 'needle',
        path: appDir,
        output_mode: 'files_with_matches',
      },
      createToolContext({ cwd: appDir }),
    )

    assert.equal(result.ok, true)
    assert.deepEqual(result.output.filenames, ['src.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Grep still searches node_modules when the path explicitly targets it', async () => {
  const dir = await createTempDir('dclaw-grep-explicit-node-modules-')
  const appDir = join(dir, 'app')
  const nodeModulesDir = join(appDir, 'node_modules', 'pkg')

  try {
    await mkdir(nodeModulesDir, { recursive: true })
    await writeFile(join(nodeModulesDir, 'index.txt'), 'needle in package\n', 'utf8')

    const result = await grepTool.call(
      {
        pattern: 'needle',
        path: nodeModulesDir,
        output_mode: 'files_with_matches',
      },
      createToolContext({ cwd: appDir }),
    )

    assert.equal(result.ok, true)
    assert.deepEqual(result.output.filenames, ['node_modules/pkg/index.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fallback file collection skips default excluded directories unless explicitly targeted', async () => {
  const dir = await createTempDir('dclaw-fallback-exclude-')
  const nodeModulesDir = join(dir, 'node_modules', 'pkg')

  try {
    await mkdir(nodeModulesDir, { recursive: true })
    await writeFile(join(dir, 'root.txt'), 'root\n', 'utf8')
    await writeFile(join(nodeModulesDir, 'index.txt'), 'pkg\n', 'utf8')

    const collected = await collectFiles({
      cwd: dir,
      targetPath: dir,
    })
    assert.deepEqual(
      collected.map(file => file.relativePath).sort(),
      ['root.txt'],
    )

    const explicitlyCollected = await collectFiles({
      cwd: dir,
      targetPath: nodeModulesDir,
    })
    assert.deepEqual(
      explicitlyCollected.map(file => file.relativePath),
      ['node_modules/pkg/index.txt'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fallback grep also skips default excluded directories', async () => {
  const dir = await createTempDir('dclaw-fallback-grep-exclude-')
  const nodeModulesDir = join(dir, 'node_modules', 'pkg')

  try {
    await mkdir(nodeModulesDir, { recursive: true })
    await writeFile(join(dir, 'root.txt'), 'needle root\n', 'utf8')
    await writeFile(join(nodeModulesDir, 'index.txt'), 'needle package\n', 'utf8')

    const result = await fallbackGrep({
      cwd: dir,
      targetPath: dir,
      pattern: 'needle',
    })

    assert.deepEqual(
      result.map(match => match.path),
      ['root.txt'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
