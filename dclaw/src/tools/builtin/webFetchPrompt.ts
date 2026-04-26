export const DESCRIPTION =
  'Fetch public web content from a URL, extract readable text, and return it with lightweight metadata. Supported remote images are returned as structured image content. PDFs, Office documents, and other unsupported binary payloads return structured unsupported results so the model can choose a skill or Bash fallback.'

export const PROMPT = `Fetch and analyze public web content from a URL.

Usage notes:

- The URL must be a valid HTTP or HTTPS URL
- Non-localhost HTTP URLs are automatically upgraded to HTTPS
- The prompt should clearly describe what information to extract or focus on
- This tool is read-only and does not modify local files
- Results may be truncated or summarized when the source content is large
- If a URL redirects to a different host, use the returned redirect target for a follow-up fetch when needed
- For GitHub pages or repository workflows, prefer Bash with gh when command-line GitHub access is a better fit
- If the active runtime does not accept image input and no image fallback runtime is configured, image fetches return a structured unsupported result instead of failing at provider call time
- If the URL returns a PDF, DOCX, XLSX, PPTX, or another unsupported binary payload, this tool returns a structured unsupported result instead of guessing, so you can call the Skill tool with \`skill_name: pdf\`, \`doc\`, or \`spreadsheet\` when appropriate
`
