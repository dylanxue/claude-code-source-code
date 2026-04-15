import type { ToolResult } from '../../types/tool.js'
import type { Tool } from '../types.js'

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
> = {
  name: 'AskUserQuestion',
  description: 'Ask the user one or more multiple-choice questions.',
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
}
