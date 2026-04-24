export const DESCRIPTION = 'List all tasks in the current session task list.'

export const PROMPT = `Use this tool to list all tasks in the current session task list.

## When to Use This Tool

- To see what tasks are available to work on
- To check overall progress on the current request
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work
- When multiple tasks are available, prefer working on tasks in ID order
- After leaving plan mode or resuming work, use this tool before creating new tasks so execution follows the current task list

## Output

Returns a summary of each task:

- **id**: Task identifier, used with TaskGet and TaskUpdate
- **subject**: Brief description of the task
- **status**: \`pending\`, \`in_progress\`, or \`completed\`
- **owner**: Current owner when assigned
- **blockedBy**: Open task IDs that must be resolved first

Use TaskGet with a specific task ID to view the full description and dependency details before starting work.
`
