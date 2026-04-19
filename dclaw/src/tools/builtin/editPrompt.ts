export const DESCRIPTION = 'Edit a file in place.'

export const PROMPT = `Perform exact string replacements in an existing file.

Usage:

- You must use the Read tool before editing a file
- Preserve indentation exactly when constructing old_string and new_string
- old_string must match the existing file contents exactly
- The edit fails if old_string is not found
- The edit also fails if old_string matches multiple locations and replace_all is not true
- Use replace_all only when you intentionally want to update every occurrence

When to use this tool:

- Prefer Edit for targeted changes to an existing file
- Prefer Write only for creating a new file or replacing the full contents of a file
- Prefer the smallest clearly unique old_string that still identifies the right location

Important:

- This tool is for exact replacements, not approximate patch application
- If the file changed since it was read, read it again before editing
`
