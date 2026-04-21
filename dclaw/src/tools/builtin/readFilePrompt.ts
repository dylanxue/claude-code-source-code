export const DESCRIPTION =
  'Read a file from the local filesystem. Read the whole file when it is reasonably small. For large files, use offset and limit to read specific portions, or search for specific content first. This tool can also read supported local images.'

export const FILE_PATH_DESCRIPTION = 'Absolute path to the file to read.'

export const PATH_ALIAS_DESCRIPTION =
  'Alias for file_path. Prefer file_path for Claude Code compatibility.'

export const OFFSET_DESCRIPTION =
  '1-based starting line number. Use with limit when the file is too large to read at once or when you only need a specific section.'

export const LIMIT_DESCRIPTION =
  'Maximum number of lines to read. Use with offset to read a specific portion of a larger file.'

export const PROMPT = `Read a file from the local filesystem.

Usage:

- The file_path parameter must be an absolute path
- Prefer file_path over path when possible; path is only a compatibility alias
- Read the whole file when it is reasonably small and you need full context
- For larger files, or when you already know the relevant area, use offset and limit to read only the needed portion
- If you are still trying to find where something is defined, prefer Grep before repeatedly reading large files
- This tool can read supported local images (PNG, JPG, JPEG, GIF, WEBP). When reading an image file, the image is attached for visual analysis
- offset and limit only apply to text reads; they are not valid for image files
- This tool reads files, not directories

Output notes:

- Returns the selected text plus startLine, endLine, and totalLines metadata
- Image reads return metadata in the tool output plus structured image content for follow-up analysis
- If the file is empty or the requested offset is past EOF, the result includes a warning
- Partial reads are tracked as partial views, so mutating tools may still require a full read before editing
`
