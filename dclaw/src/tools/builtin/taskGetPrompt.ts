export const DESCRIPTION = 'Get a task by ID from the current turn execution task list.'

export const PROMPT = `Use this tool to retrieve a task by its ID from the current turn execution task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies, including what it blocks and what blocks it
- After selecting a task from TaskList, before making task updates or beginning implementation

## Output

Returns full task details:

- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: \`pending\`, \`in_progress\`, \`completed\`, or \`cancelled\`
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its \`blockedBy\` list is empty before beginning work
- Use TaskList to see all tasks in summary form
`
