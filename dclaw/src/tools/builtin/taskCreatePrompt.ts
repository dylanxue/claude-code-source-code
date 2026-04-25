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
- When existing tasks are insufficient and you discover a concrete follow-up task that must be tracked explicitly

## When NOT to Use This Tool

Skip using this tool when:

- There is only a single straightforward task
- The work is trivial and tracking adds no value
- The task can be completed in fewer than 3 trivial steps
- The task is purely conversational or informational
- You already have a relevant task list for the current work batch and can continue by using TaskList, TaskGet, and TaskUpdate
- The work is a major new requirement or scope change that should first be surfaced to the user before you expand the plan

## Task Board Brief

For the first task in a complex work batch, include the optional **board** object when the current board does not already explain the work. This keeps the short-lived task board self-contained without creating a separate runtime plan.

- **title**: Short name for this work batch
- **purpose**: What this board is trying to accomplish
- **background**: User intent, decisions, or constraints that matter now
- **plan**: How this batch should be executed
- **scope**: What this batch includes or excludes
- **verification**: How completion should be checked

## Task Fields

- **subject**: Brief actionable title in imperative form
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown while the task is in progress

All tasks are created with status \`pending\`.

## Tips

- Check TaskList first to avoid creating duplicate tasks
- After leaving plan mode or resuming work, prefer consuming the existing task list instead of creating a brand-new execution batch during implementation
- After creating tasks, use TaskUpdate to add dependencies when needed
- When you begin work on a task, mark it as \`in_progress\` before starting
- When you finish the work completely, mark it as \`completed\`
- When finishing a task reveals small follow-up work, create a focused follow-up task instead of leaving it implicit
- When finishing a task reveals a substantial new workstream, do not silently expand scope. Finish the current turn, explain the newly discovered work to the user, and treat any new task list as follow-on work after user alignment
`
