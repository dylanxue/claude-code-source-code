import type { QueryEngine } from '../core/queryEngine.js'
import { formatTranscript } from '../session/transcript.js'
import { runHistory } from './history.js'
import type { CommonCliOptions } from './types.js'

export type ReplCommandContext = {
  engine: QueryEngine
  options: CommonCliOptions
  mode: 'interactive' | 'resume'
}

function printLines(lines: string[]): void {
  process.stdout.write(lines.join('\n') + '\n')
}

function printHelp(): void {
  printLines([
    'REPL commands:',
    '/help        Show available REPL commands.',
    '/history     Show recent saved sessions.',
    '/transcript  Show the current conversation transcript.',
    '/exit        Exit the REPL.',
    '',
  ])
}

function printTranscript(engine: QueryEngine): void {
  const transcriptLines = formatTranscript(engine.getMessages(), {
    includeThinking: false,
  })

  printLines([
    'current transcript:',
    ...(transcriptLines.length > 0 ? transcriptLines : ['<empty>']),
    '',
  ])
}

export async function maybeHandleReplCommand(
  prompt: string,
  context: ReplCommandContext,
): Promise<boolean> {
  switch (prompt.trim().toLowerCase()) {
    case '/help':
      printHelp()
      return true
    case '/transcript':
      printTranscript(context.engine)
      return true
    case '/history':
      await runHistory({
        mode: 'history',
        options: context.options,
      })
      return true
    default:
      return false
  }
}
