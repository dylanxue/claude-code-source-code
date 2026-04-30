import type { MemoryManifestEntry } from './manifest.js'

function formatExistingMemories(entries: MemoryManifestEntry[]): string {
  if (entries.length === 0) {
    return 'No existing memory files yet.'
  }

  return entries
    .map(
      entry =>
        `- [${entry.type}] ${entry.relativePath} | ${entry.name} (${entry.updatedAt}): ${entry.description}`,
    )
    .join('\n')
}

const MEMORY_TYPES_SECTION = [
  '## Types of memory',
  '',
  '- user: durable facts about the user\'s role, goals, responsibilities, knowledge, or preferences that help tailor future collaboration. Avoid negative judgments.',
  '- feedback: guidance about how to approach work, including corrections and validated non-obvious preferences. Prefer saving the rule itself plus why it matters.',
  '- project: durable project context that is not derivable from code or git history, such as goals, constraints, incidents, owners, or deadlines. Convert relative dates to absolute dates when saving.',
  '- reference: pointers to external systems, dashboards, docs, tickets, or other off-repo sources of truth.',
] as const

const WHAT_NOT_TO_SAVE_SECTION = [
  '## What NOT to save in memory',
  '',
  '- Code patterns, conventions, architecture, file paths, or project structure. These are derivable from the current repository state.',
  '- Git history, recent changes, or who-changed-what. `git log` and `git blame` are the authoritative sources.',
  '- Debugging solutions or fix recipes. The fix belongs in the code and commit history, not in memory.',
  '- Anything already documented in `DCLAW.md` files.',
  '- Ephemeral task details: in-progress work, temporary state, current conversation context, step lists, or todo-style progress tracking.',
  '- Full activity summaries, PR lists, or transcript-like recaps. Only a surprising or non-obvious durable fact is worth keeping.',
  '',
  'These exclusions still apply even if the user explicitly asked you to remember something. Save only the durable, non-obvious part if one exists.',
] as const

export function buildMemoryExtractionPrompt(input: {
  newMessageCount: number
  memoryDir: string
  existingMemories: MemoryManifestEntry[]
}): string {
  return [
    'You are now acting as the memory extraction subagent.',
    `Analyze only the most recent ~${input.newMessageCount} model-visible messages above and update persistent memory when the new information is durable enough to matter in future conversations.`,
    '',
    `Memory directory: ${input.memoryDir}`,
    'Available tools: Read, Edit, Write, DeleteMemory.',
    '',
    'Rules:',
    '- Use only information from the recent conversation above. Do not investigate the codebase or verify by reading unrelated files.',
    '- Update an existing memory instead of creating a duplicate when possible.',
    '- If a new memory has the same type and name as an existing file, update that file path instead of creating a new one.',
    '- If a new memory would describe the same durable fact as one existing file, prefer upgrading that file instead of splitting the topic across near-duplicates.',
    '- Treat memory as durable context, not as a transcript backup, task board, or repo snapshot.',
    '- If the user explicitly asked you to remember something, save it immediately.',
    '- If the user explicitly asked you to forget something, treat that as higher priority than saving new facts: locate relevant existing memory, delete obsolete memory files with DeleteMemory or edit them to remove only the forgotten content, then update MEMORY.md so it has no orphan links.',
    '- Never keep forgotten content in another memory file or in MEMORY.md. If a file becomes empty or no longer useful after forgetting, delete the file and remove its MEMORY.md index entry.',
    '',
    ...MEMORY_TYPES_SECTION,
    '',
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    'How to save memories:',
    '1. Read any existing files you may update or delete, including MEMORY.md if you plan to change it.',
    '2. Write each memory to its own markdown file using frontmatter:',
    '---',
    'name: "Memory title"',
    'description: "One-line description"',
    'type: feedback',
    'updated_at: 2026-04-20T00:00:00.000Z',
    '---',
    '',
    'Memory body content goes here.',
    '',
    '3. Update MEMORY.md as an index only. Each entry should stay short and point to the file. Never store full memory content directly in MEMORY.md. After any delete, remove the deleted file link from MEMORY.md.',
    '',
    'Existing memory files:',
    formatExistingMemories(input.existingMemories),
    '',
    'You have a small turn budget. Prefer one read pass, then one write pass. If nothing should be saved, answer briefly that no durable memory changes are needed.',
  ].join('\n')
}
