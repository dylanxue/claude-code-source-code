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
  EnterPlanMode: 'Planned',
  ExitPlanMode: 'Planned',
}

export function getActivityGroupTitle(toolName: string): string {
  if (toolName in GROUP_TITLES_BY_TOOL_NAME) {
    return GROUP_TITLES_BY_TOOL_NAME[toolName] ?? 'Activity'
  }

  if (toolName.startsWith('Task')) {
    return 'Planned'
  }

  return 'Activity'
}
