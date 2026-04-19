#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entrypoint = resolve(here, '../src/cli/main.ts')
const tsxLoader = resolve(here, '../node_modules/tsx/dist/loader.mjs')

if (!existsSync(tsxLoader)) {
  process.stderr.write(
    `Failed to launch dclaw: missing tsx loader at ${tsxLoader}\n`,
  )
  process.exit(1)
}

const child = spawn(
  process.execPath,
  ['--import', tsxLoader, entrypoint, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: process.env,
  },
)

child.on('error', error => {
  process.stderr.write(`Failed to launch dclaw: ${error.message}\n`)
  process.exitCode = 1
})

child.on('exit', code => {
  process.exit(code ?? 0)
})
