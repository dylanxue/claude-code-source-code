export const DESCRIPTION = 'Search file contents with regex.'

export const PROMPT = `Search file contents with ripgrep-compatible regular expressions.

Usage:

- ALWAYS use Grep for content-search tasks instead of running "grep" or "rg" through Bash
- Use pattern for the regex to search for
- Use path to limit the search to a file or directory
- Use glob or type to narrow the searched file set
- output_mode "content" returns matching lines
- output_mode "files_with_matches" returns matching file paths
- output_mode "count" returns per-file match counts

Helpful notes:

- Use multiline: true when the pattern needs to span multiple lines
- Use -A, -B, -C, or context only with content output
- Use head_limit and offset to keep large result sets under control
- Prefer Grep over Read when you are still locating the relevant part of a file
`
