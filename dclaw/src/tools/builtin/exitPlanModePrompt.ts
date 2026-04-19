const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

export const DESCRIPTION =
  'Request to exit plan mode after the plan is ready and ask the user for approval to start implementation.'

export const PROMPT = `Use this tool when you are in plan mode, your plan file is ready, and you want user approval to begin implementation.

## How This Tool Works

- You should already have written the plan to the active plan file
- This tool does not take the full plan content as input
- It signals that planning is complete and asks the user whether implementation may begin
- The optional note parameter is only a short summary of why the plan is ready

## When to Use This Tool

- Use it only for implementation planning workflows that are ready for approval
- Do not use it for pure research or codebase exploration tasks that never entered a real planning workflow

## Before Using This Tool

- Make sure the plan is concrete enough to implement
- If requirements or approach questions remain unresolved, use ${ASK_USER_QUESTION_TOOL_NAME} first
- Once the plan is finalized, use this tool to request approval

Important:

- Do NOT use ${ASK_USER_QUESTION_TOOL_NAME} to ask "Is this plan okay?" or "Should I proceed?"
- ExitPlanMode is the approval request step
`
