export const DESCRIPTION =
  'Delegate a bounded task to a subagent, send follow-up instructions, wait for completion, or stop it.'

export const PROMPT = `Use this tool to manage subagents for self-contained work.

Actions:
- spawn: create a subagent for a bounded task
- send: queue a follow-up message for an existing subagent
- wait: run or wait for a subagent and return a concise completion summary
- stop: stop a subagent that should no longer continue

Keep delegation scoped and concrete. Prefer waiting for a result instead of copying the child transcript back into the main conversation.`
