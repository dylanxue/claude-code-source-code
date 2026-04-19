export const DESCRIPTION =
  'Request to enter plan mode proactively for non-trivial implementation work when user sign-off on the approach before coding would improve alignment.'

export const PROMPT = `Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool enters plan mode so you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. New feature implementation
- Adding meaningful new functionality
- Example: "Add a logout button" - where should it go? What should happen on click?
- Example: "Add form validation" - what rules? What error messages?

2. Multiple valid approaches
- The task can be solved in several different ways
- Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
- Example: "Improve performance" - many optimization strategies possible

3. Code modifications
- Changes that affect existing behavior or structure
- Example: "Update the login flow" - what exactly should change?
- Example: "Refactor this component" - what's the target architecture?

4. Architectural decisions
- The task requires choosing between patterns or technologies
- Example: "Add real-time updates" - WebSockets vs SSE vs polling
- Example: "Implement state management" - Redux vs Context vs custom solution

5. Multi-file changes
- The task will likely touch more than 2-3 files
- Example: "Refactor the authentication system"
- Example: "Add a new API endpoint with tests"

6. Unclear requirements
- You need to explore before understanding the full scope
- Example: "Make the app faster" - need to profile and identify bottlenecks
- Example: "Fix the bug in checkout" - need to investigate root cause

7. User preferences matter
- The implementation could reasonably go multiple ways
- If you would otherwise need to ask the user to choose an approach, prefer EnterPlanMode so you can explore first and present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:

- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research or exploration tasks

## What Happens in Plan Mode

In plan mode, you should:
1. Explore the codebase with read-only tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions about auth flow and token handling

User: "Optimize the database queries"
- Multiple approaches are possible, and the tradeoffs matter

User: "Implement dark mode"
- Theme architecture affects many components

User: "Add a delete button to the user profile"
- Seems simple but still involves placement, confirmation flow, API behavior, and state updates

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool requires explicit user approval
- If unsure whether to use it, err on the side of planning
- Use plan mode to reduce rework when approach alignment matters more than immediate execution
`
