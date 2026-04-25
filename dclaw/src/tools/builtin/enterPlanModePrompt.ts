export const DESCRIPTION =
  'Enter a high-constraint no-implementation planning lock when the user wants planning before implementation or asks you not to change code yet.'

export const PROMPT = `Use this tool only when the current request needs a high-constraint no-implementation planning lock. Plan mode lets you explore with read-only tools and write the active plan file, but it is not the default path for normal implementation work and it does not create a separate runtime Plan object.

## When to Use This Tool

Use EnterPlanMode when ANY of these conditions apply:

1. The user explicitly asks to plan before coding
- "先规划，别写代码"
- "先出一个方案，等我确认"
- "只做调研和设计，暂时不要改文件"

2. You need a read-only exploration phase before implementation
- The task is high risk, broad, or ambiguous enough that premature edits would be harmful
- The user wants a plan file or reviewable design artifact before work starts

3. The user asks for a high-constraint planning workflow
- They want the plan delivered first, with implementation deferred until a later instruction

## When NOT to Use This Tool

Do not enter plan mode merely because a task is non-trivial. For normal implementation requests:

- Create or update a task list with TaskCreate / TaskUpdate when tracking is useful
- Start implementation directly when the user asked you to do the work
- Keep the plan and task list current during execution
- Use normal assistant text when the user only asks "what is the plan?" and does not ask for a high-constraint planning workflow
- Do not enter plan mode for pure research or informational questions

## What Happens in Plan Mode

In plan mode, you should:
1. Explore the codebase with read-only tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Write and refine the plan in the plan file
5. Exit the planning lock with ExitPlanMode when ready to present the plan

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Only if the user also says to plan first, wait for confirmation, or avoid edits until the plan is reviewed

User: "先规划认证方案，别动代码"
- Explicit high-constraint planning request

### BAD - Don't use EnterPlanMode:
User: "Add user authentication to the app"
- Normal implementation request. Create a task list if useful and start work.

User: "先列一下任务，然后直接做"
- The user wants planning and immediate implementation. Use TaskCreate / TaskUpdate, not plan mode.

User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- Task boards are the runtime execution state; plan mode is only a temporary no-implementation lock
- If unsure, prefer normal task tracking unless the user clearly wants a no-edits planning phase
- EnterPlanMode starts the planning lock immediately; ExitPlanMode presents the plan and waits for the user
- Use plan mode to reduce premature edits when approach alignment matters more than immediate execution
`
