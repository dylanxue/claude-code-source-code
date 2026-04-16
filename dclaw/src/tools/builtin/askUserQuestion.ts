import type {
  AskUserQuestion,
  AskUserQuestionOption,
  ToolResult,
} from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'

export type AskUserQuestionAnnotations = Record<
  string,
  {
    preview?: string
    notes?: string
  }
>

export type AskUserQuestionInput = {
  questions: AskUserQuestion[]
  answers?: Record<string, string>
  annotations?: AskUserQuestionAnnotations
}

export type AskUserQuestionOutput = {
  questions: AskUserQuestionInput['questions']
  answers: Record<string, string>
  annotations?: AskUserQuestionAnnotations
}

function getQuestionAnswerKey(question: AskUserQuestion): string {
  return question.id?.trim() || question.question
}

function hasDuplicateValues(values: string[]): boolean {
  const normalized = values
    .map(value => value.trim())
    .filter(value => value.length > 0)

  return normalized.length !== new Set(normalized).size
}

function normalizeAnswers(
  questions: AskUserQuestion[],
  answers: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {}

  for (const question of questions) {
    const key = getQuestionAnswerKey(question)
    const candidate = answers[key] ?? answers[question.question]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      normalized[key] = candidate
    }
  }

  return normalized
}

export const askUserQuestionTool: Tool<
  AskUserQuestionInput,
  AskUserQuestionOutput
> = buildTool({
  name: 'AskUserQuestion',
  description: 'Ask the user one or more multiple-choice questions.',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Optional stable identifier for the question. When present, answers are keyed by this id instead of the question text.',
            },
            question: {
              type: 'string',
              description: 'Prompt shown to the user.',
            },
            header: {
              type: 'string',
              description: 'Short header label shown alongside the question.',
            },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    description: 'Short option label.',
                  },
                  description: {
                    type: 'string',
                    description: 'One-sentence explanation of the option.',
                  },
                  preview: {
                    type: 'string',
                    description: 'Optional preview content for richer UIs. The terminal host currently ignores this field.',
                  },
                },
                required: ['label', 'description'],
                additionalProperties: false,
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Whether multiple options may be selected.',
            },
          },
          required: ['question', 'header', 'options'],
          additionalProperties: false,
        },
      },
      answers: {
        type: 'object',
        additionalProperties: {
          type: 'string',
        },
        description: 'Optional pre-filled answers for non-interactive execution.',
      },
      annotations: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            preview: { type: 'string' },
            notes: { type: 'string' },
          },
          additionalProperties: false,
        },
        description: 'Optional per-question annotations for richer hosts.',
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            question: { type: 'string' },
            header: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  description: { type: 'string' },
                  preview: { type: 'string' },
                },
                required: ['label', 'description'],
                additionalProperties: false,
              },
            },
            multiSelect: { type: 'boolean' },
          },
          required: ['question', 'header', 'options'],
          additionalProperties: false,
        },
      },
      answers: {
        type: 'object',
        additionalProperties: {
          type: 'string',
        },
      },
      annotations: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            preview: { type: 'string' },
            notes: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    required: ['questions', 'answers'],
    additionalProperties: false,
  },
  validate(input, context) {
    if (!Array.isArray(input.questions) || input.questions.length === 0) {
      return {
        ok: false,
        error: 'AskUserQuestion requires at least one question',
      }
    }

    if (input.questions.length > 4) {
      return {
        ok: false,
        error: 'AskUserQuestion supports at most 4 questions',
      }
    }

    for (const question of input.questions) {
      if (!question.question || !question.header) {
        return {
          ok: false,
          error: 'Each AskUserQuestion item requires question and header',
        }
      }

      if (!Array.isArray(question.options) || question.options.length < 2) {
        return {
          ok: false,
          error: 'Each AskUserQuestion item requires at least 2 options',
        }
      }

      if (question.options.length > 4) {
        return {
          ok: false,
          error: 'Each AskUserQuestion item supports at most 4 options',
        }
      }

      if (question.header.trim().length > 12) {
        return {
          ok: false,
          error: 'Each AskUserQuestion header must be 12 characters or fewer',
        }
      }

      if (
        hasDuplicateValues(
          question.options.map((option: AskUserQuestionOption) => option.label),
        )
      ) {
        return {
          ok: false,
          error: 'Each AskUserQuestion item requires unique option labels',
        }
      }
    }

    if (
      hasDuplicateValues(
        input.questions.map((question: AskUserQuestion) =>
          getQuestionAnswerKey(question),
        ),
      )
    ) {
      return {
        ok: false,
        error: 'AskUserQuestion requires unique question ids or question texts',
      }
    }

    if (!input.answers && !context.askUserQuestions) {
      return {
        ok: false,
        error: 'AskUserQuestion requires an interactive host',
      }
    }

    return { ok: true }
  },
  isReadOnly() {
    return true
  },
  isEnabled(context) {
    return Boolean(context.askUserQuestions)
  },
  async call(input, context): Promise<ToolResult<AskUserQuestionOutput>> {
    const rawAnswers =
      input.answers ?? (await context.askUserQuestions?.(input.questions)) ?? {}
    const answers = normalizeAnswers(input.questions, rawAnswers)

    return {
      ok: true,
      output: {
        questions: input.questions,
        answers,
        ...(input.annotations ? { annotations: input.annotations } : {}),
      },
      summary: `Collected ${Object.keys(answers).length} answer(s)`,
    }
  },
})
