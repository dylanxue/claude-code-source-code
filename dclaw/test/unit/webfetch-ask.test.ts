import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import { webFetchTool } from '../../src/tools/builtin/webFetch.js'
import { askUserQuestionTool } from '../../src/tools/builtin/askUserQuestion.js'
import { createToolContext } from '../helpers/toolContext.js'

test('WebFetch strips HTML and includes prompt context', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<html><body><h1>Hello</h1><script>ignored()</script><p>World</p></body></html>',
    )
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  try {
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IPv4 test server address')
    }

    const result = await webFetchTool.call(
      {
        url: `http://127.0.0.1:${address.port}/`,
        prompt: 'Summarize the page',
      },
      createToolContext(),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.code, 200)
    assert.match(result.output.result, /Prompt: Summarize the page/)
    assert.match(result.output.result, /Hello World/)
    assert.doesNotMatch(result.output.result, /ignored\(\)/)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('AskUserQuestion uses host answers when available', async () => {
  const result = await askUserQuestionTool.call(
    {
      questions: [
        {
          header: 'Choice',
          question: 'Pick one',
          options: [
            { label: 'A', description: 'Option A' },
            { label: 'B', description: 'Option B' },
          ],
        },
      ],
    },
    createToolContext({
      askUserQuestions: async () => ({ choice: 'A' }),
    }),
  )

  assert.equal(result.ok, true)
  assert.deepEqual(result.output.answers, { choice: 'A' })
})

test('AskUserQuestion validation rejects missing interactive host', async () => {
  const validation = await askUserQuestionTool.validate?.(
    {
      questions: [
        {
          header: 'Choice',
          question: 'Pick one',
          options: [
            { label: 'A', description: 'Option A' },
            { label: 'B', description: 'Option B' },
          ],
        },
      ],
    },
    createToolContext(),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'AskUserQuestion requires an interactive host',
  })
})

test('AskUserQuestion validation rejects too many questions', async () => {
  const questions = Array.from({ length: 5 }, (_, index) => ({
    header: `Q${index}`,
    question: `Question ${index}`,
    options: [
      { label: 'A', description: 'Option A' },
      { label: 'B', description: 'Option B' },
    ],
  }))

  const validation = await askUserQuestionTool.validate?.(
    { questions },
    createToolContext({
      askUserQuestions: async () => ({}),
    }),
  )

  assert.deepEqual(validation, {
    ok: false,
    error: 'AskUserQuestion supports at most 4 questions',
  })
})
