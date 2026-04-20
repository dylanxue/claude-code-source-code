export const DESCRIPTION = 'Update a task in the current session task list.'

export const PROMPT = `Use this tool to update a task in the current session task list.

## When to Use This Tool

- Mark a task as \`in_progress\` when you start working on it
- Mark a task as \`completed\` only when the work is fully done
- Mark a task as \`deleted\` when it is no longer needed
- Update the subject, description, metadata, owner, or dependencies when the task state changes
- If you become blocked, keep the task active and create a new task describing the blocker that must be resolved

## Status Workflow

Status normally progresses: \`pending\` -> \`in_progress\` -> \`completed\`

Use \`deleted\` only to remove a task permanently.

## Important Rules

- Make sure to read a task's latest state using \`TaskGet\` before updating it
- Only mark a task as \`completed\` when you have fully accomplished it
- Do not mark a task as \`completed\` if tests are failing, implementation is partial, or blockers remain
- After resolving a task, call TaskList again to find the next available work
- If you cannot finish because of an unresolved blocker, keep the task \`in_progress\` and create a separate task for the blocker only when the blocker belongs inside the currently approved plan
- Do not use follow-up tasks to silently replace the approved task list with a new execution plan; prefer continuing through the existing tasks
- If you discover a substantial new workstream or scope change, surface it to the user at the end of the current turn instead of silently expanding the task list

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

Delete a task that is no longer needed:
\`\`\`json
{"taskId":"1","status":"deleted"}
\`\`\`

Set up task dependencies:
\`\`\`json
{"taskId":"2","addBlockedBy":["1"]}
\`\`\`
`
