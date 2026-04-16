import { createInterface } from 'node:readline/promises'
import type { AskUserQuestion, AskUserQuestionOption } from '../types/tool.js'

function formatOption(index: number, option: AskUserQuestionOption): string {
  return `${index + 1}. ${option.label} - ${option.description}`
}

function getQuestionAnswerKey(question: AskUserQuestion): string {
  return question.id?.trim() || question.question
}

function parseAnswer(raw: string, question: AskUserQuestion): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }

  if (question.multiSelect) {
    const parts = trimmed
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
    const labels = parts.map(part => {
      const index = Number(part)
      if (!Number.isNaN(index) && index >= 1 && index <= question.options.length) {
        return question.options[index - 1]?.label
      }
      return undefined
    })
    if (labels.some(label => !label)) {
      return undefined
    }
    return labels.join(', ')
  }

  const index = Number(trimmed)
  if (Number.isNaN(index) || index < 1 || index > question.options.length) {
    return undefined
  }

  return question.options[index - 1]?.label
}

export async function askUserQuestionsInteractively(
  questions: AskUserQuestion[],
): Promise<Record<string, string>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('AskUserQuestion requires an interactive TTY')
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const answers: Record<string, string> = {}

  try {
    for (const question of questions) {
      process.stdout.write(`\n[${question.header}] ${question.question}\n`)
      for (let index = 0; index < question.options.length; index += 1) {
        const option = question.options[index]
        if (!option) {
          continue
        }
        process.stdout.write(`${formatOption(index, option)}\n`)
      }

      const hint = question.multiSelect
        ? '选择一个或多个编号，使用逗号分隔: '
        : '选择一个编号: '

      let answer: string | undefined
      while (!answer) {
        const raw = await rl.question(hint)
        answer = parseAnswer(raw, question)
      }

      answers[getQuestionAnswerKey(question)] = answer
    }
  } finally {
    rl.close()
  }

  return answers
}
