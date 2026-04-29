import { createInterface } from 'node:readline/promises'
import type {
  AskUserQuestion,
  AskUserQuestionAnnotations,
  AskUserQuestionHostAction,
  AskUserQuestionHostResult,
  AskUserQuestionOption,
  PermissionMode,
} from '../types/tool.js'
import { getInteractiveQuestionHost } from './interactiveQuestionHost.js'

const OTHER_OPTION_LABEL = 'Other'
const OTHER_OPTION_DESCRIPTION = 'Provide a custom answer in your own words.'

type ParsedAnswer = {
  labels: string[]
  wantsCustomText: boolean
}

type AskFn = (hint: string) => Promise<string>

function isPreviewQuestion(question: AskUserQuestion): boolean {
  return Boolean(question.preview?.trim()) ||
    question.options.some(option => option.preview?.trim())
}

function formatOption(index: number, option: AskUserQuestionOption): string {
  return `${index + 1}. ${option.label} - ${option.description}`
}

function formatOptionPreview(option: AskUserQuestionOption): string[] {
  const preview = option.preview?.trim()
  if (!preview) {
    return []
  }

  return [
    '   ---',
    ...preview.split('\n').map(line => `   ${line}`),
    '   ---',
  ]
}

function formatQuestionPreview(question: AskUserQuestion): string[] {
  const preview = question.preview?.trim()
  if (!preview) {
    return []
  }

  return [
    '---',
    ...preview.split('\n'),
    '---',
  ]
}

function getQuestionAnswerKey(question: AskUserQuestion): string {
  return question.id?.trim() || question.question
}

function getOptionsWithOther(
  question: AskUserQuestion,
): AskUserQuestionOption[] {
  if (isPreviewQuestion(question)) {
    return question.options
  }

  return [
    ...question.options,
    {
      label: OTHER_OPTION_LABEL,
      description: OTHER_OPTION_DESCRIPTION,
    },
  ]
}

function parseAnswer(
  raw: string,
  question: AskUserQuestion,
): ParsedAnswer | undefined {
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }

  const hasImplicitOther = !isPreviewQuestion(question)
  const otherIndex = hasImplicitOther ? question.options.length + 1 : undefined

  if (question.multiSelect) {
    const parts = trimmed
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
    const labels: string[] = []
    let wantsCustomText = false

    for (const part of parts) {
      const index = Number(part)
      const maxIndex = otherIndex ?? question.options.length
      if (Number.isNaN(index) || index < 1 || index > maxIndex) {
        return undefined
      }

      if (otherIndex !== undefined && index === otherIndex) {
        wantsCustomText = true
        continue
      }

      const label = question.options[index - 1]?.label
      if (!label) {
        return undefined
      }

      labels.push(label)
    }

    if (labels.length === 0 && !wantsCustomText) {
      return undefined
    }

    return { labels, wantsCustomText }
  }

  const index = Number(trimmed)
  const maxIndex = otherIndex ?? question.options.length
  if (Number.isNaN(index) || index < 1 || index > maxIndex) {
    return undefined
  }

  if (otherIndex !== undefined && index === otherIndex) {
    return { labels: [], wantsCustomText: true }
  }

  const label = question.options[index - 1]?.label
  if (!label) {
    return undefined
  }

  return { labels: [label], wantsCustomText: false }
}

function getSelectedPreview(
  question: AskUserQuestion,
  labels: string[],
): string | undefined {
  if (labels.length === 0) {
    return undefined
  }

  const selected = question.options.find(option => option.label === labels[0])
  return selected?.preview?.trim() || undefined
}

function addAnnotation(
  annotations: AskUserQuestionAnnotations,
  question: AskUserQuestion,
  preview: string | undefined,
  notes: string | undefined,
): void {
  if (!preview && !notes) {
    return
  }

  annotations[getQuestionAnswerKey(question)] = {
    ...(preview ? { preview } : {}),
    ...(notes ? { notes } : {}),
  }
}

async function askOptionalNotes(ask: AskFn): Promise<string | undefined> {
  const raw = await ask('可选备注，直接回车跳过: ')
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function askPreviewNextStep(
  ask: AskFn,
  permissionMode: PermissionMode | undefined,
): Promise<'continue' | AskUserQuestionHostAction> {
  const inPlanMode = permissionMode === 'plan'

  process.stdout.write('\n接下来怎么处理？\n')
  process.stdout.write('1. Continue - 提交当前答案并继续\n')
  process.stdout.write('2. Chat about this - 回到对话继续说明\n')
  if (inPlanMode) {
    process.stdout.write(
      '3. Skip interview and plan immediately - 停止继续提问，直接完成计划\n',
    )
  }

  while (true) {
    const raw = await ask(inPlanMode ? '选择一个编号 (1-3): ' : '选择一个编号 (1-2): ')
    const trimmed = raw.trim()

    if (trimmed === '1') {
      return 'continue'
    }

    if (trimmed === '2') {
      return 'respond_to_agent'
    }

    if (inPlanMode && trimmed === '3') {
      return 'finish_plan_interview'
    }
  }
}

export async function askUserQuestionsInteractively(
  questions: AskUserQuestion[],
  options: {
    permissionMode?: PermissionMode
    allowPreviewActions?: boolean
  } = {},
): Promise<Record<string, string> | AskUserQuestionHostResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('AskUserQuestion requires an interactive TTY')
  }

  const sharedQuestionHost = getInteractiveQuestionHost()
  const rl = sharedQuestionHost
    ? null
    : createInterface({
        input: process.stdin,
        output: process.stdout,
      })
  const ask = (hint: string): Promise<string> =>
    sharedQuestionHost ? sharedQuestionHost.question(hint) : rl!.question(hint)

  const answers: Record<string, string> = {}
  const annotations: AskUserQuestionAnnotations = {}
  let shouldReturnStructuredResult = false

  try {
    for (const question of questions) {
      process.stdout.write(`\n[${question.header}] ${question.question}\n`)
      for (const line of formatQuestionPreview(question)) {
        process.stdout.write(`${line}\n`)
      }
      const renderedOptions = getOptionsWithOther(question)

      for (let index = 0; index < renderedOptions.length; index += 1) {
        const option = renderedOptions[index]
        if (!option) {
          continue
        }
        process.stdout.write(`${formatOption(index, option)}\n`)
        for (const line of formatOptionPreview(option)) {
          process.stdout.write(`${line}\n`)
        }
      }

      const hasImplicitOther =
        renderedOptions.length > question.options.length
      const hint = question.multiSelect
        ? hasImplicitOther
          ? '选择一个或多个编号，使用逗号分隔；最后一项可输入自定义内容: '
          : '选择一个或多个编号，使用逗号分隔: '
        : hasImplicitOther
          ? '选择一个编号；最后一项可输入自定义内容: '
          : '选择一个编号: '

      let parsed: ParsedAnswer | undefined
      while (!parsed) {
        const raw = await ask(hint)
        parsed = parseAnswer(raw, question)
      }

      let customText: string | undefined
      if (parsed.wantsCustomText) {
        while (!customText) {
          const raw = await ask('请输入自定义内容: ')
          const trimmed = raw.trim()
          if (trimmed) {
            customText = trimmed
          }
        }
      }

      const answerParts = [...parsed.labels]
      if (customText) {
        answerParts.push(customText)
      }
      const answer = answerParts.join(', ')
      answers[getQuestionAnswerKey(question)] = answer

      if (!isPreviewQuestion(question) || options.allowPreviewActions !== true) {
        continue
      }

      shouldReturnStructuredResult = true
      const notes = await askOptionalNotes(ask)
      const preview = getSelectedPreview(question, parsed.labels)
      addAnnotation(annotations, question, preview, notes)

      const nextStep = await askPreviewNextStep(ask, options.permissionMode)
      if (nextStep !== 'continue') {
        return {
          answers,
          ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
          action: nextStep,
        }
      }
    }
  } finally {
    rl?.close()
  }

  if (shouldReturnStructuredResult) {
    return {
      answers,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
      action: 'submit_answers',
    }
  }

  return answers
}
