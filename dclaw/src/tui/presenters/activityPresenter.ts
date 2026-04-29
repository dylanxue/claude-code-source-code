const GROUP_TITLES_BY_TOOL_NAME: Record<string, string> = {
  Read: 'Explored',
  Glob: 'Explored',
  Grep: 'Explored',
  FileSearch: 'Explored',
  Edit: 'Edited',
  Write: 'Edited',
  StructuredPatch: 'Edited',
  Bash: 'Ran',
  WebFetch: 'Checked',
  GitDiff: 'Checked',
  Agent: 'Delegated',
  AskUserQuestion: 'Questions',
  EnterPlanMode: 'Planned',
  ExitPlanMode: 'Planned',
}

function isExplorationBashCommand(input: Record<string, unknown>): boolean {
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  return /^(ls|tree|find|rg|grep|git\s+(status|diff|log|show|ls-files)\b)/u.test(command)
}

export function getActivityGroupTitle(
  toolName: string,
  input: Record<string, unknown> = {},
): string {
  if (toolName === 'Bash' && isExplorationBashCommand(input)) {
    return 'Explored'
  }

  if (toolName in GROUP_TITLES_BY_TOOL_NAME) {
    return GROUP_TITLES_BY_TOOL_NAME[toolName] ?? 'Activity'
  }

  if (toolName.startsWith('Task')) {
    return 'Planned'
  }

  return 'Activity'
}
