import type { ToolResultContent } from '../types/tool.js'

export type UnsupportedContentNextStep =
  | 'use_skill'
  | 'use_bash_fallback'
  | 'ask_for_text_alternative'
  | 'configure_image_support'

export type UnsupportedContentError = {
  code: 'unsupported_content_type' | 'unsupported_runtime_capability'
  source: 'read' | 'webfetch'
  path?: string
  url?: string
  detectedMediaType?: string
  detectedExtension?: string
  contentKind: 'image' | 'pdf' | 'office_document' | 'unknown_binary'
  suggestedNextSteps: UnsupportedContentNextStep[]
}

export type UnsupportedContentToolOutput = {
  type: 'unsupported_content'
  error: UnsupportedContentError
}

function getContentKindLabel(
  contentKind: UnsupportedContentError['contentKind'],
): string {
  switch (contentKind) {
    case 'image':
      return 'image'
    case 'pdf':
      return 'PDF document'
    case 'office_document':
      return 'Office document'
    case 'unknown_binary':
      return 'binary file'
  }
}

function getSourceLabel(error: UnsupportedContentError): string {
  return error.path ?? error.url ?? '<unknown>'
}

function getRecommendedSkillName(
  error: UnsupportedContentError,
): string | undefined {
  if (error.contentKind === 'pdf') {
    return 'pdf'
  }

  const extension = error.detectedExtension?.toLowerCase()
  if (!extension) {
    return undefined
  }

  if (extension === 'doc' || extension === 'docx') {
    return 'doc'
  }

  if (
    extension === 'csv' ||
    extension === 'ods' ||
    extension === 'tsv' ||
    extension === 'xls' ||
    extension === 'xlsx'
  ) {
    return 'spreadsheet'
  }

  return undefined
}

export function createUnsupportedContentError(
  error: UnsupportedContentError,
): UnsupportedContentToolOutput {
  return {
    type: 'unsupported_content',
    error,
  }
}

export function createUnsupportedContentText(
  error: UnsupportedContentError,
): string {
  const recommendedSkill = getRecommendedSkillName(error)
  const lines =
    error.code === 'unsupported_runtime_capability'
      ? [
          `${error.source === 'read' ? 'Read' : 'WebFetch'} cannot analyze this ${getContentKindLabel(error.contentKind)} because the active runtime does not accept image input and no image fallback runtime is configured.`,
          '',
          `${error.source === 'read' ? 'Path' : 'URL'}: ${getSourceLabel(error)}`,
        ]
      : [
          `${error.source === 'read' ? 'Read' : 'WebFetch'} cannot directly process this ${getContentKindLabel(error.contentKind)} in the current built-in path.`,
          '',
          `${error.source === 'read' ? 'Path' : 'URL'}: ${getSourceLabel(error)}`,
        ]

  if (error.detectedMediaType) {
    lines.push(`Detected media type: ${error.detectedMediaType}`)
  }
  if (error.detectedExtension) {
    lines.push(`Detected extension: .${error.detectedExtension}`)
  }

  lines.push('', 'Recommended next steps:')

  for (const step of error.suggestedNextSteps) {
    if (step === 'ask_for_text_alternative') {
      lines.push('- Continue without image analysis, or ask the user for a text description of the image.')
      continue
    }
    if (step === 'configure_image_support') {
      lines.push('- If image analysis is required, switch to an image-capable primary model or configure imageFallback.')
      continue
    }
    if (step === 'use_skill') {
      lines.push(
        recommendedSkill
          ? `- Call the Skill tool with skill_name: \`${recommendedSkill}\` for this file type.`
          : '- Call the Skill tool with an appropriate document-analysis skill for this file type.',
      )
      continue
    }
    if (step === 'use_bash_fallback') {
      lines.push('- If no skill is available, use Bash/Python to inspect or convert the file.')
    }
  }

  return lines.join('\n')
}

export function createUnsupportedContentResult(
  error: UnsupportedContentError,
  summary: string,
): {
  ok: false
  output: UnsupportedContentToolOutput
  content: ToolResultContent[]
  summary: string
} {
  return {
    ok: false,
    output: createUnsupportedContentError(error),
    content: [
      {
        type: 'text',
        text: createUnsupportedContentText(error),
      },
    ],
    summary,
  }
}
