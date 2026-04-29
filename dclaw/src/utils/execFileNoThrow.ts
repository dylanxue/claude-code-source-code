import { spawn } from 'node:child_process'

type ExecFileOptions = {
  abortSignal?: AbortSignal
  env?: NodeJS.ProcessEnv
  input?: string
  preserveOutputOnError?: boolean
  stdin?: 'ignore' | 'inherit' | 'pipe'
  timeout?: number
  useCwd?: boolean
}

type ExecFileResult = {
  code: number
  error?: string
  stderr: string
  stdout: string
}

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
): Promise<ExecFileResult> {
  return new Promise(resolve => {
    const child = spawn(file, args, {
      cwd: options.useCwd === false ? undefined : process.cwd(),
      env: options.env,
      stdio: [
        options.stdin === 'inherit' ? 'inherit' : 'pipe',
        'pipe',
        'pipe',
      ],
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false

    const finish = (result: ExecFileResult): void => {
      if (settled) {
        return
      }

      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      options.abortSignal?.removeEventListener('abort', abort)
      resolve(result)
    }

    const getOutput = (): Omit<ExecFileResult, 'code'> => ({
      stderr: Buffer.concat(stderr).toString('utf8'),
      stdout: Buffer.concat(stdout).toString('utf8'),
    })

    const abort = (): void => {
      child.kill('SIGTERM')
      finish({
        ...getOutput(),
        code: 1,
        error: 'aborted',
      })
    }

    const timer =
      options.timeout === undefined
        ? undefined
        : setTimeout(() => {
            child.kill('SIGTERM')
            finish({
              ...getOutput(),
              code: 1,
              error: 'timeout',
            })
          }, options.timeout)
    timer?.unref?.()

    options.abortSignal?.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.on('error', error => {
      finish({
        ...getOutput(),
        code: 1,
        error: error.message,
      })
    })
    child.on('close', (code, signal) => {
      finish({
        ...getOutput(),
        code: code ?? 1,
        ...(signal ? { error: signal } : {}),
      })
    })

    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input)
    } else if (options.stdin !== 'inherit') {
      child.stdin?.end()
    }
  })
}
