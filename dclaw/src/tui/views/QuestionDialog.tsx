import React from 'react'
import { Box, Text } from '../../ink/index.js'
import type { AskUserQuestion, AskUserQuestionOption } from '../../types/tool.js'

export type QuestionDialogMode = 'select' | 'custom' | 'notes' | 'next_action'

export type QuestionDialogState = {
  allowPreviewActions: boolean
  currentQuestionIndex: number
  customInput: string
  mode: QuestionDialogMode
  notesInput: string
  permissionMode?: string
  questions: AskUserQuestion[]
  selectedActionIndex: number
  selectedOptionIndexes: number[]
  selectedOptionIndex: number
}

type Props = {
  dialog: QuestionDialogState
}

const OTHER_OPTION: AskUserQuestionOption = {
  label: 'Other',
  description: 'Provide a custom answer in your own words.',
}

function isPreviewQuestion(question: AskUserQuestion): boolean {
  return Boolean(question.preview?.trim()) ||
    question.options.some(option => option.preview?.trim())
}

export function getQuestionAnswerKey(question: AskUserQuestion): string {
  return question.id?.trim() || question.question
}

export function getQuestionOptions(question: AskUserQuestion): AskUserQuestionOption[] {
  return isPreviewQuestion(question) ? question.options : [...question.options, OTHER_OPTION]
}

function getNextActionOptions(permissionMode: string | undefined): Array<{
  label: string
  value: 'continue' | 'respond_to_agent' | 'finish_plan_interview'
}> {
  return [
    { label: 'Continue', value: 'continue' },
    { label: 'Chat about this', value: 'respond_to_agent' },
    ...(permissionMode === 'plan'
      ? [{ label: 'Skip interview and plan immediately', value: 'finish_plan_interview' as const }]
      : []),
  ]
}

function OptionLine({
  isActive,
  isSelected,
  option,
}: {
  isActive: boolean
  isSelected: boolean
  option: AskUserQuestionOption
}) {
  const marker = isSelected ? '[x]' : '[ ]'

  return (
    <Box flexDirection="column">
      <Text color={isActive ? 'cyan' : undefined}>
        {`${isActive ? '›' : ' '} ${marker} ${option.label}  ${option.description}`}
      </Text>
      {option.preview?.trim() ? (
        <Box flexDirection="column" paddingLeft={4}>
          {option.preview.trim().split('\n').map((line, index) => (
            <Text key={`${option.label}-preview-${index}`} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

export function QuestionDialog({ dialog }: Props) {
  const question = dialog.questions[dialog.currentQuestionIndex]
  if (!question) {
    return null
  }

  const options = getQuestionOptions(question)
  const nextActions = getNextActionOptions(dialog.permissionMode)

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>{question.header}</Text>
      <Text>{question.question}</Text>
      {question.preview?.trim() ? (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          {question.preview.trim().split('\n').map((line, index) => (
            <Text key={`question-preview-${index}`} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box height={1} />
      {dialog.mode === 'custom' ? (
        <>
          <Text dimColor>Custom answer</Text>
          <Text>{`> ${dialog.customInput}`}</Text>
          <Box height={1} />
          <Text dimColor>Press enter to submit or esc to go back</Text>
        </>
      ) : dialog.mode === 'notes' ? (
        <>
          <Text dimColor>Optional notes</Text>
          <Text>{`> ${dialog.notesInput}`}</Text>
          <Box height={1} />
          <Text dimColor>Press enter to continue, or leave empty</Text>
        </>
      ) : dialog.mode === 'next_action' ? (
        <>
          <Text dimColor>Next step</Text>
          {nextActions.map((action, index) => (
            <Text
              key={action.value}
              color={index === dialog.selectedActionIndex ? 'cyan' : undefined}
            >
              {`${index === dialog.selectedActionIndex ? '›' : ' '} ${action.label}`}
            </Text>
          ))}
          <Box height={1} />
          <Text dimColor>Press enter to select</Text>
        </>
      ) : (
        <>
          {options.map((option, index) => {
            const isSelected = question.multiSelect
              ? dialog.selectedOptionIndexes.includes(index)
              : dialog.selectedOptionIndex === index
            return (
              <OptionLine
                key={option.label}
                isActive={dialog.selectedOptionIndex === index}
                isSelected={isSelected}
                option={option}
              />
            )
          })}
          <Box height={1} />
          <Text dimColor>
            {question.multiSelect
              ? 'Use space to toggle, enter to submit, esc to close'
              : 'Use arrows, enter to select, esc to close'}
          </Text>
        </>
      )}
    </Box>
  )
}
