export const DESCRIPTION = 'List all tasks in the current turn execution task list.'

export const PROMPT = `Use this tool to list all tasks in the current turn execution task list.

## When to Use This Tool

- To see what tasks are available to work on during execution
- To check overall progress on the current execution batch
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work
- Once implementation has started, use this tool before creating new tasks so execution follows the current task list
- Do not use this tool as a planning artifact during plan mode; task lists belong to execution

## Output

Returns a summary of each task:

- **id**: Task identifier, used with TaskGet and TaskUpdate
- **subject**: Brief description of the task
- **status**: \`pending\`, \`in_progress\`, \`completed\`, or \`cancelled\`
- **owner**: Current owner when assigned
- **blockedBy**: Open task IDs that must be resolved first

Use TaskGet with a specific task ID to view the full description and dependency details before starting work.
`
