export const DESCRIPTION =
  'Fetch public web content from a URL, extract readable text, and return it with lightweight metadata. Prefer specialized tools for authenticated sites.'

export const PROMPT = `Fetch and analyze public web content from a URL.

Usage notes:

- The URL must be a valid HTTP or HTTPS URL
- Non-localhost HTTP URLs are automatically upgraded to HTTPS
- The prompt should clearly describe what information to extract or focus on
- This tool is read-only and does not modify local files
- Results may be truncated or summarized when the source content is large
- If a URL redirects to a different host, use the returned redirect target for a follow-up fetch when needed
- For GitHub pages or repository workflows, prefer Bash with gh when command-line GitHub access is a better fit
`
