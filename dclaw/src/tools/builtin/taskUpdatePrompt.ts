export const DESCRIPTION = 'Update a task in the current turn execution task list.'

export const PROMPT = `Use this tool to update a task in the current turn execution task list during execution.

## When to Use This Tool

- Mark a task as \`in_progress\` when you start working on it
- Mark a task as \`completed\` only when the work is fully done
- Mark a task as \`cancelled\` when it cannot or should not continue in this execution batch
- Update the subject, description, metadata, owner, or dependencies when the task state changes
- If you become blocked, keep the current task state accurate and add dependency metadata when the blocker belongs inside this execution batch

## Status Workflow

Status normally progresses: \`pending\` -> \`in_progress\` -> \`completed\`

Use \`cancelled\` only when the task should terminate without completion.

## Important Rules

- TaskUpdate is for execution, not planning
- Make sure to read a task's latest state using \`TaskGet\` before updating it
- Task boards represent active implementation work. Once a task list exists, continue implementation until no unfinished tasks remain.
- Do not pause for non-essential conversation while \`pending\` or \`in_progress\` tasks remain. The exceptions are required permission requests and AskUserQuestion calls needed to unblock or clarify the work.
- Only one task may be \`in_progress\` at a time. If another task is already active, finish or cancel it before starting a new one.
- Only mark a task as \`completed\` when you have fully accomplished it
- Do not mark a task as \`completed\` if tests are failing, implementation is partial, or blockers remain
- After resolving a task, call TaskList again to find the next available work
- If you cannot finish because of an unresolved blocker, keep the task \`in_progress\` unless the task should terminate in this batch
- Do not use follow-up tasks to silently replace the current task list with a new execution plan; prefer continuing through the existing tasks
- If you discover a substantial new workstream that does not belong inside the current execution batch, do not silently replace the current board with it; ask the user only when that new work blocks continued execution

## Fields You Can Update

- **status**: New task status
- **subject**: New task title
- **description**: New task description
- **activeForm**: Present continuous form shown while in progress
- **owner**: Current task owner
- **metadata**: Metadata keys to merge into the task
- **addBlocks**: Tasks that cannot start until this task completes
- **addBlockedBy**: Tasks that must complete before this task can start

## Examples

Mark a task as in progress when starting work:
\`\`\`json
{"taskId":"1","status":"in_progress"}
\`\`\`

Mark a task as completed after finishing work:
\`\`\`json
{"taskId":"1","status":"completed"}
\`\`\`

Cancel a task that should not continue in this execution batch:
\`\`\`json
{"taskId":"1","status":"cancelled"}
\`\`\`

Set up task dependencies:
\`\`\`json
{"taskId":"2","addBlockedBy":["1"]}
\`\`\`
`
