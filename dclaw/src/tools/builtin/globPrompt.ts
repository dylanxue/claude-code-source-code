export const DESCRIPTION = 'Fast file pattern matching tool.'

export const PROMPT = `Find files by path pattern.

Use this tool when you need to locate files by name or wildcard path:

- Match patterns like "**/*.ts", "src/**/*.tsx", or "package*.json"
- Use the optional path field to limit the search to a specific directory
- Prefer this tool over Bash find commands for normal file-discovery work

When to use other tools instead:

- If you need to search file contents, use Grep instead
- If you already know the exact file path and need to inspect contents, use Read instead

Output notes:

- Returns matching file paths plus search metadata
- Results may be truncated when many files match
`
