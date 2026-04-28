const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

export const DESCRIPTION =
  'Exit the no-implementation planning lock after the plan is ready, present the plan, and wait for the user to decide the next step.'

export const PROMPT = `Use this tool when you are in plan mode and your plan file is ready to show to the user.

## How This Tool Works

- You should already have written the plan to the active plan file
- This tool does not take the full plan content as input
- It leaves the high-constraint planning lock and returns the plan content
- It does not ask an interactive approval question
- It does not create tasks or start implementation
- Task creation belongs to the execution phase and should happen only when you are ready to begin implementation immediately
- It does not complete or retire any execution task board
- The optional note parameter is only a short summary of why the plan is ready to present

## When to Use This Tool

- Use it only for real plan-mode workflows where the plan is ready to present
- Do not use it for pure research or codebase exploration tasks that never entered a real planning workflow

## Before Using This Tool

- Make sure the plan is concrete enough to implement
- If requirements or approach questions remain unresolved, use ${ASK_USER_QUESTION_TOOL_NAME} first
- Once the plan is finalized, use this tool to deliver it to the user

Important:

- Do NOT use ${ASK_USER_QUESTION_TOOL_NAME} to ask "Is this plan okay?" or "Should I proceed?"
- ExitPlanMode is not an approval step
- After using ExitPlanMode, show the plan to the user and say: "If this direction looks good, I can start implementation; if you want changes, tell me what you would like adjusted."
- Then wait for the user's next instruction instead of calling more implementation tools in the same turn
- Do not call TaskCreate or TaskUpdate in the same turn that you exit plan mode
`
