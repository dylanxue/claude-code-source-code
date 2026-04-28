export const DESCRIPTION =
  'Start a fresh execution task list for the current turn.'

export const PROMPT = `Use this tool to create a structured task list for the current execution batch. It helps you track implementation work that is starting now and keep the execution state visible.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Multi-step implementation work that truly requires 3 or more concrete tasks
- Non-trivial execution work that benefits from explicit tracking
- The user explicitly asks for a todo list or task tracking and you are ready to start implementation immediately
- The user provides multiple concrete work items that you are about to execute

## When NOT to Use This Tool

Skip using this tool when:

- There is only a single straightforward task
- The work is trivial and tracking adds no value
- The work breaks into fewer than 3 concrete tasks
- You are in plan mode or otherwise still planning, researching, or discussing the approach
- You are not ready to begin implementation immediately after creating tasks
- The task is purely conversational or informational
- You already have an execution task list for the current turn and should continue it with TaskList, TaskGet, and TaskUpdate
- The work is a major new requirement or scope change that should first be surfaced to the user before you expand the plan

## Initializing a Task Board

- A fresh task board must start with 3 or more concrete tasks, not one umbrella task
- Prefer a single TaskCreate call with the **tasks** array to seed 3-6 actionable tasks at once
- Do NOT initialize a new board with a single generic task such as "Build the app" or "Implement the feature"
- If the work breaks into fewer than 3 concrete tasks, skip TaskCreate for now
- If you are not going to start implementation immediately after creating tasks, skip TaskCreate for now
- This tool no longer supports single-task creation; use one **tasks** array per execution batch

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
- **tasks**: Batch-create the concrete tasks for this execution batch

All tasks are created immediately, and the first task automatically becomes \`in_progress\`.

## Tips

- Check TaskList first to avoid creating duplicate tasks
- Do not use this tool in plan mode; planning produces a plan, not tasks
- When starting a new task board, think through the decomposition first and create at least 3 concrete tasks rather than a single umbrella task
- Creating tasks means execution starts now; TaskCreate automatically starts the first task and you should continue implementation in the same turn
- Continue executing through the task list until no unfinished tasks remain; do not pause for non-essential conversation while unfinished work remains
- If you need user input or permission to continue, use AskUserQuestion or the permission flow and then resume execution
- After creating tasks, use TaskUpdate to add dependencies when needed
- Only one task may be \`in_progress\` at a time
- When you finish the work completely, mark it as \`completed\`
- When finishing a task reveals a substantial new workstream, do not silently expand scope. Finish the current turn, explain the newly discovered work to the user, and treat any new task list as follow-on work after user alignment
`
