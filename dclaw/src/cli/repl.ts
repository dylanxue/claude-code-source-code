import { createInterface } from 'node:readline/promises'
import { registerInteractiveQuestionHost } from './interactiveQuestionHost.js'

export type ReplLoopOptions = {
  initialPrompt?: string
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  promptText?: string
  onPrompt: (prompt: string) => Promise<void>
  onPromptError?: (error: unknown) => Promise<void> | void
}

const EXIT_COMMANDS = new Set([
  '/exit',
  'exit',
  'quit',
  '/quit',
  '.exit',
  '.quit',
])

function trimPrompt(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export function canStartInteractiveRepl(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): boolean {
  return Boolean(
    (input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY &&
      (output as NodeJS.WritableStream & { isTTY?: boolean }).isTTY,
  )
}

export async function runInteractiveReplLoop(
  options: ReplLoopOptions,
): Promise<void> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const promptText = options.promptText ?? 'dclaw> '
  const initialPrompt = trimPrompt(options.initialPrompt)
  const interactive = canStartInteractiveRepl(input, output)

  const runPrompt = async (prompt: string): Promise<void> => {
    try {
      await options.onPrompt(prompt)
    } catch (error) {
      if (!interactive || !options.onPromptError) {
        throw error
      }

      await options.onPromptError(error)
    }
  }

  if (initialPrompt) {
    await runPrompt(initialPrompt)
  }

  if (!interactive) {
    return
  }

  output.write('REPL ready. Type /exit to quit.\n')

  const rl = createInterface({
    input,
    output,
    terminal: true,
  })
  const unregisterQuestionHost = registerInteractiveQuestionHost({
    question(prompt: string) {
      return rl.question(prompt)
    },
  })
  const isClosed = (): boolean =>
    (rl as typeof rl & { closed?: boolean }).closed === true

  try {
    rl.setPrompt(promptText)
    rl.prompt()

    for await (const line of rl) {
      const trimmed = trimPrompt(line)
      if (!trimmed) {
        if (!isClosed()) {
          rl.prompt()
        }
        continue
      }

      if (EXIT_COMMANDS.has(trimmed.toLowerCase())) {
        break
      }

      await runPrompt(trimmed)
      if (!isClosed()) {
        rl.prompt()
      }
    }
  } finally {
    unregisterQuestionHost()
    rl.close()
  }
}
