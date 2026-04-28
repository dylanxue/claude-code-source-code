export const DESCRIPTION =
  'Enter a high-constraint no-implementation planning lock when the user wants planning before implementation or asks you not to change code yet.'

export const PROMPT = `Use this tool only when the current request needs a high-constraint no-implementation planning lock. Plan mode is for creating and refining a plan before execution. It is not task tracking, and it is not implementation.

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

- Start implementation directly when the user asked you to do the work
- If task tracking will help during execution, wait until you are ready to execute immediately; then create tasks and start implementation in the same turn
- Use normal assistant text when the user only asks "what is the plan?" and does not ask for a high-constraint planning workflow
- Do not enter plan mode for pure research or informational questions

## What Happens in Plan Mode

In plan mode, you should:
1. Explore the codebase with read-only tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Write and refine the plan in the plan file
5. Use AskUserQuestion only when you need clarification to finish the plan
6. Do not create or update tasks while planning
7. Exit the planning lock with ExitPlanMode when ready to present the plan

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Only if the user also says to plan first, wait for confirmation, or avoid edits until the plan is reviewed

User: "先规划认证方案，别动代码"
- Explicit high-constraint planning request

### BAD - Don't use EnterPlanMode:
User: "Add user authentication to the app"
- Normal implementation request. Start work directly; if you want task tracking, create tasks only when execution is beginning.

User: "先列一下任务，然后直接做"
- The user wants planning and immediate implementation. Stay out of plan mode. Create tasks only when you are ready to start execution immediately.

User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- Plan mode is for plan creation only; task tracking begins only when execution begins
- If unsure, prefer normal execution or a normal response unless the user clearly wants a no-edits planning phase
- EnterPlanMode starts the planning lock immediately; ExitPlanMode presents the plan and waits for the user
- Do not create or update tasks in plan mode
`
