import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import { StubLlmClient } from '../../src/llm/providers/stub.js'
import { createTextMessage } from '../../src/types/message.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { createToolContext } from '../helpers/toolContext.js'

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

test('plan mode blocks mutating tool calls', async () => {
  const dir = await createTempDir('dclaw-plan-mode-')
  const filePath = join(dir, 'blocked.txt')
  const registry = createDefaultToolRegistry()

  try {
    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [
        createTextMessage(
          'user',
          `tool:Write file_path=${filePath} content=hello`,
        ),
      ],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'plan',
      }),
    })

    assert.match(
      result.outputText,
      /Permission mode plan does not allow mutating tool calls/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('accept-edits mode allows Write without prompting', async () => {
  const dir = await createTempDir('dclaw-accept-mode-')
  const filePath = join(dir, 'written.txt')
  const registry = createDefaultToolRegistry()

  try {
    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [
        createTextMessage(
          'user',
          `tool:Write file_path=${filePath} content=hello`,
        ),
      ],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'accept-edits',
      }),
    })

    assert.match(result.outputText, /"ok": true/)
    assert.equal(await readFile(filePath, 'utf8'), 'hello')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('plan mode still allows read-only tools', async () => {
  const dir = await createTempDir('dclaw-plan-read-')
  const filePath = join(dir, 'readable.txt')
  const registry = createDefaultToolRegistry()

  try {
    await writeFile(filePath, 'hello', 'utf8')
    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [
        createTextMessage('user', `tool:Read file_path=${filePath}`),
      ],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'plan',
      }),
    })

    assert.match(result.outputText, /"ok": true/)
    assert.match(result.outputText, /"type": "text"/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('accept-edits mode still blocks Bash without interactive approval', async () => {
  const registry = createDefaultToolRegistry()

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [createTextMessage('user', 'tool:Bash command=touch\\ testfile')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'accept-edits',
    }),
  })

  assert.match(
    result.outputText,
    /In accept-edits mode, only file edits are auto-approved/,
  )
})

test('default mode can allow Bash through interactive approval', async () => {
  const registry = createDefaultToolRegistry()

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [createTextMessage('user', 'tool:Bash command=pwd')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'default',
      askUserQuestions: async () => ({ permission: 'Allow' }),
    }),
  })

  assert.match(result.outputText, /"ok": true/)
  assert.match(result.outputText, /work\/claude-code-source-code\/dclaw/)
})

test('default mode allows read-only Bash without interactive approval', async () => {
  const registry = createDefaultToolRegistry()

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [createTextMessage('user', 'tool:Bash command=pwd')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'default',
    }),
  })

  assert.match(result.outputText, /"ok": true/)
  assert.match(result.outputText, /work\/claude-code-source-code\/dclaw/)
})

test('default mode allows wrapped read-only Bash without interactive approval', async () => {
  const registry = createDefaultToolRegistry()

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [createTextMessage('user', 'tool:Bash command=time\\ pwd')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'default',
    }),
  })

  assert.match(result.outputText, /"ok": true/)
  assert.match(result.outputText, /work\/claude-code-source-code\/dclaw/)
})

test('default mode allows safe-env-prefixed read-only Bash without interactive approval', async () => {
  const registry = createDefaultToolRegistry()

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [createTextMessage('user', 'tool:Bash command=TZ=UTC\\ pwd')],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'default',
    }),
  })

  assert.match(result.outputText, /"ok": true/)
  assert.match(result.outputText, /work\/claude-code-source-code\/dclaw/)
})

test('default mode blocks Bash with output redirection without interactive approval', async () => {
  const registry = createDefaultToolRegistry()

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [
      createTextMessage('user', 'tool:Bash command=pwd\\ \\>\\ redirected.txt'),
    ],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'default',
    }),
  })

  assert.match(result.outputText, /Permission denied for tool Bash in default mode/)
})

test('default mode blocks Bash with shell expansion in output redirection without interactive approval', async () => {
  const registry = createDefaultToolRegistry()

  const result = await executeSingleTurn({
    client: new StubLlmClient(),
    messages: [
      createTextMessage('user', 'tool:Bash command=pwd\\ \\>\\ \\$DCLAW_REDIRECT'),
    ],
    toolRegistry: registry,
    toolContext: createToolContext({
      availableTools: registry.list().map(tool => tool.name),
      permissionMode: 'default',
    }),
  })

  assert.match(
    result.outputText,
    /Shell expansion syntax in Bash output redirection requires manual approval/,
  )
})

test('default mode can allow Bash with shell expansion in output redirection after approval', async () => {
  const dir = await createTempDir('dclaw-bash-redirect-')
  const filePath = join(dir, 'approved.txt')
  const registry = createDefaultToolRegistry()
  const previousValue = process.env.DCLAW_REDIRECT
  process.env.DCLAW_REDIRECT = filePath

  try {
    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [
        createTextMessage(
          'user',
          'tool:Bash command=printf\\ hello\\ \\>\\ \\$DCLAW_REDIRECT',
        ),
      ],
      toolRegistry: registry,
      toolContext: createToolContext({
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'default',
        askUserQuestions: async () => ({ permission: 'Allow' }),
      }),
    })

    assert.match(result.outputText, /"ok": true/)
    assert.equal(await readFile(filePath, 'utf8'), 'hello')
  } finally {
    if (previousValue === undefined) {
      delete process.env.DCLAW_REDIRECT
    } else {
      process.env.DCLAW_REDIRECT = previousValue
    }
    await rm(dir, { recursive: true, force: true })
  }
})

test("default mode blocks Bash that combines cd with output redirection without interactive approval", async () => {
  const dir = await createTempDir('dclaw-bash-cd-')
  const nestedDir = join(dir, 'nested')
  const registry = createDefaultToolRegistry()

  try {
    await mkdir(nestedDir, { recursive: true })
    const result = await executeSingleTurn({
      client: new StubLlmClient(),
      messages: [
        createTextMessage(
          'user',
          'tool:Bash command=cd\\ nested\\ \\&\\&\\ pwd\\ \\>\\ output.txt',
        ),
      ],
      toolRegistry: registry,
      toolContext: createToolContext({
        cwd: dir,
        availableTools: registry.list().map(tool => tool.name),
        permissionMode: 'default',
      }),
    })

    assert.match(
      result.outputText,
      /combine 'cd' with output redirection require manual approval/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
