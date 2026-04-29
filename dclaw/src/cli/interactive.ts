import type { InteractiveCommand } from './types.js'
import { runInteractiveTui } from './interactiveTui.js'

type InteractiveRunners = {
  runTui: (command: InteractiveCommand) => Promise<void>
}

const defaultInteractiveRunners: InteractiveRunners = {
  runTui: runInteractiveTui,
}

export async function runInteractive(
  command: InteractiveCommand,
  runners: InteractiveRunners = defaultInteractiveRunners,
): Promise<void> {
  await runners.runTui(command)
}
