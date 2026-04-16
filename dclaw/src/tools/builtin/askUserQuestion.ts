import type { ToolResult } from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'

export type AskUserQuestionOption = {
  label: string
  description: string
}

export type AskUserQuestionInput = {
  questions: Array<{
    question: string
    header: string
    options: AskUserQuestionOption[]
    multiSelect?: boolean
  }>
  answers?: Record<string, string>
}

export type AskUserQuestionOutput = {
  questions: AskUserQuestionInput['questions']
  answers: Record<string, string>
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
            question: { type: 'string' },
            header: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  description: { type: 'string' },
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
    const answers =
      input.answers ?? (await context.askUserQuestions?.(input.questions)) ?? {}

    return {
      ok: true,
      output: {
        questions: input.questions,
        answers,
      },
      summary: `Collected ${Object.keys(answers).length} answer(s)`,
    }
  },
})
