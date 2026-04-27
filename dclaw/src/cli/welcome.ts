import { homedir } from 'node:os'

export type WelcomeCardData = {
  appName: string
  version: string
  modelLabel: string
  cwd: string
  titlePrefix: string
  runtimeHint: string
}

function visibleLength(text: string): number {
  return [...text].length
}

function padRight(text: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(text))
  return `${text}${' '.repeat(padding)}`
}

function renderBorder(width: number, left: string, fill: string, right: string): string {
  return `${left}${fill.repeat(width + 2)}${right}`
}

export function formatPathForDisplay(cwd: string): string {
  const home = homedir()
  if (cwd === home) {
    return '~'
  }

  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd
}

export function createWelcomeCardData(input: {
  version: string
  modelLabel: string
  cwd: string
}): WelcomeCardData {
  return {
    appName: 'DCLAW',
    version: input.version,
    modelLabel: input.modelLabel,
    cwd: formatPathForDisplay(input.cwd),
    titlePrefix: '::',
    runtimeHint: '/runtime to change',
  }
}

export function formatWelcomeBanner(card: WelcomeCardData): string {
  const lines = [
    `${card.titlePrefix} ${card.appName} (v${card.version})`,
    '',
    `runtime:    ${card.modelLabel}   ${card.runtimeHint}`,
    `directory:  ${card.cwd}`,
  ]
  const width = lines.reduce((max, line) => Math.max(max, visibleLength(line)), 0)

  return [
    renderBorder(width, '╭', '─', '╮'),
    ...lines.map(line => `│ ${padRight(line, width)} │`),
    renderBorder(width, '╰', '─', '╯'),
  ].join('\n')
}
