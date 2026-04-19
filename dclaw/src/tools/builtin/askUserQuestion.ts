import type {
  AskUserQuestion,
  AskUserQuestionAnnotations,
  AskUserQuestionHostAction,
  AskUserQuestionHostResult,
  AskUserQuestionOption,
  ToolResult,
} from '../../types/tool.js'
import { buildTool, type Tool } from '../types.js'
import { DESCRIPTION, PROMPT } from './askUserQuestionPrompt.js'

export type AskUserQuestionInput = {
  questions: AskUserQuestion[]
  answers?: Record<string, string>
  annotations?: AskUserQuestionAnnotations
}

export type AskUserQuestionOutput = {
  questions: AskUserQuestionInput['questions']
  answers: Record<string, string>
  annotations?: AskUserQuestionAnnotations
  action?: AskUserQuestionHostAction
  message?: string
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

function normalizeAnnotations(
  questions: AskUserQuestion[],
  annotations?: AskUserQuestionAnnotations,
): AskUserQuestionAnnotations | undefined {
  if (!annotations) {
    return undefined
  }

  const normalized: AskUserQuestionAnnotations = {}

  for (const question of questions) {
    const key = getQuestionAnswerKey(question)
    const candidate = annotations[key] ?? annotations[question.question]
    if (!candidate) {
      continue
    }

    const preview = candidate.preview?.trim()
    const notes = candidate.notes?.trim()

    if (!preview && !notes) {
      continue
    }

    normalized[key] = {
      ...(preview ? { preview } : {}),
      ...(notes ? { notes } : {}),
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function isStructuredHostResult(
  value: Record<string, string> | AskUserQuestionHostResult,
): value is AskUserQuestionHostResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'answers' in value &&
    typeof value.answers === 'object' &&
    value.answers !== null
  )
}

function formatQuestionsWithAnswers(
  questions: AskUserQuestion[],
  answers: Record<string, string>,
): string {
  return questions
    .map(question => {
      const answer = answers[getQuestionAnswerKey(question)]
      if (answer) {
        return `- "${question.question}"\n  Answer: ${answer}`
      }

      return `- "${question.question}"\n  (No answer provided)`
    })
    .join('\n')
}

function buildActionMessage(
  action: AskUserQuestionHostAction | undefined,
  questions: AskUserQuestion[],
  answers: Record<string, string>,
): string | undefined {
  if (!action || action === 'submit_answers') {
    return undefined
  }

  const questionsWithAnswers = formatQuestionsWithAnswers(questions, answers)

  if (action === 'respond_to_agent') {
    return `The user wants to clarify these questions.
This means they may have additional information, context or questions for you.
Take their response into account and then reformulate the questions if appropriate.
Start by asking them what they would like to clarify.

Questions asked:
${questionsWithAnswers}`
  }

  return `The user has indicated they have provided enough answers for the plan interview.
Stop asking clarifying questions and proceed to finish the plan with the information you have.

Questions asked and answers provided:
${questionsWithAnswers}`
}

export const askUserQuestionTool: Tool<
  AskUserQuestionInput,
  AskUserQuestionOutput
> = buildTool({
  name: 'AskUserQuestion',
  description: DESCRIPTION,
  prompt() {
    return PROMPT
  },
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
                    description: 'Optional preview content shown by hosts that support reviewing richer context inline.',
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
      action: {
        type: 'string',
        enum: ['submit_answers', 'respond_to_agent', 'finish_plan_interview'],
      },
      message: {
        type: 'string',
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
  mapToolResult(result) {
    const output = result.output

    if (!output.action || output.action === 'submit_answers') {
      return output
    }

    return {
      action: output.action,
      message: output.message,
      answers: output.answers,
      ...(output.annotations ? { annotations: output.annotations } : {}),
    }
  },
  async call(input, context): Promise<ToolResult<AskUserQuestionOutput>> {
    const hostResult =
      input.answers
        ? { answers: input.answers, annotations: input.annotations }
        : (await context.askUserQuestions?.(input.questions, {
            permissionMode: context.permissionMode,
          })) ?? {}

    const rawAnswers = isStructuredHostResult(hostResult)
      ? hostResult.answers
      : hostResult
    const answers = normalizeAnswers(input.questions, rawAnswers)
    const annotations = normalizeAnnotations(
      input.questions,
      isStructuredHostResult(hostResult)
        ? hostResult.annotations ?? input.annotations
        : input.annotations,
    )
    const action =
      isStructuredHostResult(hostResult)
        ? hostResult.action ?? 'submit_answers'
        : 'submit_answers'
    const message = buildActionMessage(action, input.questions, answers)

    return {
      ok: true,
      output: {
        questions: input.questions,
        answers,
        ...(annotations ? { annotations } : {}),
        ...(action ? { action } : {}),
        ...(message ? { message } : {}),
      },
      summary:
        action === 'respond_to_agent'
          ? 'User wants to discuss the questions before answering.'
          : action === 'finish_plan_interview'
            ? 'User wants to stop the plan interview and finish the plan.'
            : `Collected ${Object.keys(answers).length} answer(s)`,
    }
  },
})
