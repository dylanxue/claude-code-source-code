export const DESCRIPTION = 'Create a new task in the current session task list.'

export const PROMPT = `Use this tool to create a structured task list for the current coding session. It helps you track progress, organize complex work, and make the session state visible.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks that require 3 or more distinct steps or actions
- Non-trivial work that benefits from explicit tracking
- Plan mode, where creating a task list helps structure the plan
- The user explicitly asks for a todo list or task tracking
- The user provides multiple requests or a list of things to do
- After receiving new instructions, when you should capture the new requirements as tasks
- When you finish a task and discover follow-up work that should also be tracked

## When NOT to Use This Tool

Skip using this tool when:

- There is only a single straightforward task
- The work is trivial and tracking adds no value
- The task can be completed in fewer than 3 trivial steps
- The task is purely conversational or informational

## Task Fields

- **subject**: Brief actionable title in imperative form
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown while the task is in progress

All tasks are created with status \`pending\`.

## Tips

- Check TaskList first to avoid creating duplicate tasks
- After creating tasks, use TaskUpdate to add dependencies when needed
- When you begin work on a task, mark it as \`in_progress\` before starting
- When you finish the work completely, mark it as \`completed\`
- When finishing a task reveals new work, create follow-up tasks instead of leaving that work implicit
`
