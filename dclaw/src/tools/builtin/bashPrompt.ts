export const DESCRIPTION = 'Execute a shell command.'

export const PROMPT = `Execute a shell command when command-line execution is the right tool for the job.

Prefer specialized tools over Bash when they are a better fit:

- Use Read to inspect file contents
- Use Edit to make targeted string replacements in existing files
- Use Write to create new files or fully rewrite files
- Use Glob to find files by path patterns
- Use Grep to search file contents with regex

Usage notes:

- Provide a concise description when the command is not obvious at a glance
- Use run_in_background only when you do not need the result immediately and it is acceptable to be notified later
- Do not append "&" when using run_in_background; the parameter already requests background execution
- Avoid interactive commands or flags that wait for terminal input
- Prefer non-destructive commands unless the user explicitly asked for a destructive action
- Prefer specific paths and targeted commands over broad workspace-wide mutations
- If a command is mainly for reading or searching code, prefer the dedicated read/search tools above unless shell output is specifically needed
`
