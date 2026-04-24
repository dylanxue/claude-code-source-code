import assert from 'node:assert/strict'
import test from 'node:test'
import { askUserQuestionsInteractively } from '../../src/cli/askUserQuestions.js'
import { registerInteractiveQuestionHost } from '../../src/cli/interactiveQuestionHost.js'

function setTtyFlag(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  value: boolean,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY')
  Object.defineProperty(stream, 'isTTY', {
    value,
    configurable: true,
  })

  return () => {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor)
      return
    }

    delete (stream as { isTTY?: boolean }).isTTY
  }
}

test('askUserQuestionsInteractively reuses the registered interactive question host', async () => {
  const restoreStdin = setTtyFlag(process.stdin, true)
  const restoreStdout = setTtyFlag(process.stdout, true)
  const prompts: string[] = []
  const unregister = registerInteractiveQuestionHost({
    async question(prompt: string) {
      prompts.push(prompt)
      return '1'
    },
  })

  try {
    const answers = await askUserQuestionsInteractively([
      {
        id: 'decision',
        header: 'Plan Mode',
        question: 'Enter plan mode?',
        options: [
          { label: 'Approve', description: 'Enter plan mode.' },
          { label: 'Reject', description: 'Stay in the current mode.' },
        ],
      },
    ])

    assert.deepEqual(answers, { decision: 'Approve' })
    assert.deepEqual(prompts, ['选择一个编号；最后一项可输入自定义内容: '])
  } finally {
    unregister()
    restoreStdin()
    restoreStdout()
  }
})

test('askUserQuestionsInteractively prints option previews inline', async () => {
  const restoreStdin = setTtyFlag(process.stdin, true)
  const restoreStdout = setTtyFlag(process.stdout, true)
  const prompts: string[] = []
  const unregister = registerInteractiveQuestionHost({
    async question(prompt: string) {
      prompts.push(prompt)
      return '1'
    },
  })
  const output: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write

    const result = await askUserQuestionsInteractively([
      {
        id: 'decision',
        header: 'Plan Choice',
        question: 'Choose plan direction?',
        options: [
          {
            label: 'Looks Good',
            description: 'Continue with this direction.',
            preview: '# Plan\n\n- Inspect existing flow\n- Update plan handoff UI',
          },
          {
            label: 'Revise Plan',
            description: 'Adjust the plan before continuing.',
          },
        ],
      },
    ])

    assert.deepEqual(result, { decision: 'Looks Good' })
    const text = output.join('')
    assert.match(text, /\[Plan Choice\] Choose plan direction\?/)
    assert.match(text, /1\. Looks Good - Continue with this direction\./)
    assert.doesNotMatch(text, /3\. Other - Provide a custom answer in your own words\./)
    assert.doesNotMatch(text, /Chat about this/)
    assert.match(text, /# Plan/)
    assert.match(text, /- Update plan handoff UI/)
    assert.deepEqual(prompts, ['选择一个编号: '])
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
    unregister()
    restoreStdin()
    restoreStdout()
  }
})

test('askUserQuestionsInteractively can return the preview question chat exit', async () => {
  const restoreStdin = setTtyFlag(process.stdin, true)
  const restoreStdout = setTtyFlag(process.stdout, true)
  const prompts: string[] = []
  const replies = ['1', 'Please compare both options first', '2']
  const unregister = registerInteractiveQuestionHost({
    async question(prompt: string) {
      prompts.push(prompt)
      return replies.shift() ?? ''
    },
  })

  try {
    const result = await askUserQuestionsInteractively(
      [
        {
          id: 'decision',
          header: 'Plan Choice',
          question: 'Choose plan direction?',
          options: [
            {
              label: 'Looks Good',
              description: 'Continue with this direction.',
              preview: '# Plan\n\n- Inspect existing flow\n- Update plan handoff UI',
            },
            {
              label: 'Revise Plan',
              description: 'Adjust the plan before continuing.',
            },
          ],
        },
      ],
      {
        permissionMode: 'plan',
        allowPreviewActions: true,
      },
    )

    assert.deepEqual(result, {
      answers: { decision: 'Looks Good' },
      annotations: {
        decision: {
          preview: '# Plan\n\n- Inspect existing flow\n- Update plan handoff UI',
          notes: 'Please compare both options first',
        },
      },
      action: 'respond_to_agent',
    })
    assert.deepEqual(prompts, [
      '选择一个编号: ',
      '可选备注，直接回车跳过: ',
      '选择一个编号 (1-3): ',
    ])
  } finally {
    unregister()
    restoreStdin()
    restoreStdout()
  }
})

test('askUserQuestionsInteractively only enables preview exits when requested', async () => {
  const restoreStdin = setTtyFlag(process.stdin, true)
  const restoreStdout = setTtyFlag(process.stdout, true)
  const prompts: string[] = []
  const replies = ['1', 'Keep the current structure', '3']
  const unregister = registerInteractiveQuestionHost({
    async question(prompt: string) {
      prompts.push(prompt)
      return replies.shift() ?? ''
    },
  })

  try {
    const result = await askUserQuestionsInteractively(
      [
        {
          id: 'decision',
          header: 'Plan Choice',
          question: 'Choose plan direction?',
          options: [
            {
              label: 'Looks Good',
              description: 'Continue with this direction.',
              preview: '# Plan\n\n- Inspect existing flow\n- Update plan handoff UI',
            },
            {
              label: 'Revise Plan',
              description: 'Adjust the plan before continuing.',
            },
          ],
        },
      ],
      {
        permissionMode: 'plan',
        allowPreviewActions: true,
      },
    )

    assert.deepEqual(result, {
      answers: { decision: 'Looks Good' },
      annotations: {
        decision: {
          preview: '# Plan\n\n- Inspect existing flow\n- Update plan handoff UI',
          notes: 'Keep the current structure',
        },
      },
      action: 'finish_plan_interview',
    })
    assert.deepEqual(prompts, [
      '选择一个编号: ',
      '可选备注，直接回车跳过: ',
      '选择一个编号 (1-3): ',
    ])
  } finally {
    unregister()
    restoreStdin()
    restoreStdout()
  }
})

test('askUserQuestionsInteractively supports custom text through the implicit Other option', async () => {
  const restoreStdin = setTtyFlag(process.stdin, true)
  const restoreStdout = setTtyFlag(process.stdout, true)
  const prompts: string[] = []
  const replies = ['3', 'Please also update the README']
  const unregister = registerInteractiveQuestionHost({
    async question(prompt: string) {
      prompts.push(prompt)
      return replies.shift() ?? ''
    },
  })

  try {
    const answers = await askUserQuestionsInteractively([
      {
        id: 'plan_feedback',
        header: 'Plan',
        question: 'What should change?',
        options: [
          { label: 'Looks good', description: 'Proceed as-is.' },
          { label: 'Trim scope', description: 'Reduce the first pass.' },
        ],
      },
    ])

    assert.deepEqual(answers, {
      plan_feedback: 'Please also update the README',
    })
    assert.deepEqual(prompts, ['选择一个编号；最后一项可输入自定义内容: ', '请输入自定义内容: '])
  } finally {
    unregister()
    restoreStdin()
    restoreStdout()
  }
})
