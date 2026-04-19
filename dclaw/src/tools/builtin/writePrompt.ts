export const DESCRIPTION = 'Write a file to the local filesystem.'

export const PROMPT = `Write a file to the local filesystem.

Usage:

- This tool creates a new file or fully replaces an existing file
- If the target file already exists, you MUST use the Read tool first
- Prefer Edit for targeted modifications to an existing file
- Use Write when you are creating a new file or intentionally replacing the full contents
- The file_path must be absolute

Important:

- Rewriting an existing file is a larger operation than editing a small section, so prefer the narrower tool when possible
- If the file changed since it was last read, read it again before writing
`
