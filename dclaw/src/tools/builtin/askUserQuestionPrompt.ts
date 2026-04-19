export const DESCRIPTION =
  'Ask the user one or more multiple-choice questions.'

export const PROMPT = `Use this tool when you need to ask the user questions during execution.

This tool is useful for:

1. Gathering user preferences or requirements
2. Clarifying ambiguous instructions
3. Getting decisions on implementation choices while work is in progress
4. Offering concrete options when multiple directions are reasonable

Usage notes:

- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true only when multiple answers should be allowed
- If you recommend a specific option, put it first and add "(Recommended)" to the label
- Keep question headers short and easy to scan
- Use the optional preview field only when users need to compare concrete artifacts rather than plain labels

Plan mode note:

- In plan mode, use this tool to clarify requirements or choose between approaches before finalizing the plan
- Do NOT use this tool to ask "Is the plan okay?" or "Should I proceed?"; use ExitPlanMode for plan approval instead
- IMPORTANT: Do not reference "the plan" in your questions because the user cannot see the full plan until ExitPlanMode is called
`
