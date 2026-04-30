import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAutomaticMemoryExtractor } from '../../src/memory/extract.js'
import { formatMemoryDocument } from '../../src/memory/frontmatter.js'
import { getMemoryEntrypointPath, getMemoryFilePath } from '../../src/memory/paths.js'
import { ensureMemoryScaffold } from '../../src/memory/store.js'
import {
  createMessage,
  createTextMessage,
  getTextContent,
  type Message,
} from '../../src/types/message.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'

class SuccessfulExtractionClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []
  private memoryDir?: string

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    const assistantCount = request.messages.filter(
      message => message.role === 'assistant',
    ).length
    this.memoryDir ??= getTextContent(
      request.messages.at(-1) ?? createTextMessage('user', ''),
    )
      .match(/Memory directory: (.+)/)?.[1]?.trim()

    if (assistantCount === 1) {
      const entrypointPath = this.memoryDir
        ? join(this.memoryDir, 'MEMORY.md')
        : '/placeholder'
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_read_memory_index',
            name: 'Read',
            input: {
              file_path: entrypointPath,
            },
          },
        ]),
      }
    }

    if (assistantCount === 2) {
      const entrypointPath = this.memoryDir
        ? join(this.memoryDir, 'MEMORY.md')
        : '/placeholder'
      const memoryFilePath = this.memoryDir
        ? join(this.memoryDir, 'feedback', 'terse-responses.md')
        : '/placeholder'

      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_write_memory_file',
            name: 'Write',
            input: {
              file_path: memoryFilePath,
              content: [
                '---',
                'name: "Terse Responses"',
                'description: "User prefers terse responses with no padded recap."',
                'type: feedback',
                'updated_at: 2026-04-20T12:00:00.000Z',
                '---',
                '',
                'Keep answers terse and avoid padded recap sections.',
                '',
              ].join('\n'),
            },
          },
          {
            type: 'tool_use',
            id: 'tool_write_memory_index',
            name: 'Write',
            input: {
              file_path: entrypointPath,
              content: [
                '# Memory',
                '',
                '- [Terse Responses](feedback/terse-responses.md) - User prefers terse responses with no padded recap.',
                '',
              ].join('\n'),
            },
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'memory extraction complete'),
    }
  }
}

class EscapingExtractionClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    const assistantCount = request.messages.filter(
      message => message.role === 'assistant',
    ).length

    if (assistantCount === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_write_escape',
            name: 'Write',
            input: {
              file_path: '/tmp/escape-memory.md',
              content: 'bad write',
            },
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'no memory saved'),
    }
  }
}

class DelayedSuccessfulExtractionClient extends SuccessfulExtractionClient {
  constructor(private readonly delayMs: number) {
    super()
  }

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    await new Promise(resolve => setTimeout(resolve, this.delayMs))
    return super.createMessage(request)
  }
}

class DuplicateUpgradeClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []
  private memoryDir?: string

  constructor(
    private readonly existingRelativePath: string,
    private readonly duplicateRelativePath: string,
    private readonly newMemoryContent: string,
  ) {}

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    const assistantCount = request.messages.filter(
      message => message.role === 'assistant',
    ).length
    this.memoryDir ??= getTextContent(
      request.messages.at(-1) ?? createTextMessage('user', ''),
    )
      .match(/Memory directory: (.+)/)?.[1]?.trim()

    const existingPath = this.memoryDir
      ? join(this.memoryDir, this.existingRelativePath)
      : '/placeholder'
    const duplicatePath = this.memoryDir
      ? join(this.memoryDir, this.duplicateRelativePath)
      : '/placeholder'

    if (assistantCount === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_write_duplicate_memory',
            name: 'Write',
            input: {
              file_path: duplicatePath,
              content: this.newMemoryContent,
            },
          },
        ]),
      }
    }

    if (assistantCount === 2) {
      const lastMessage = request.messages.at(-1)
      const error =
        lastMessage?.content[0] &&
        lastMessage.content[0].type === 'tool_result' &&
        typeof lastMessage.content[0].output === 'object' &&
        lastMessage.content[0].output !== null &&
        'error' in lastMessage.content[0].output &&
        typeof lastMessage.content[0].output.error === 'string'
          ? lastMessage.content[0].output.error
          : ''
      assert.match(error, new RegExp(existingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_read_existing_memory',
            name: 'Read',
            input: {
              file_path: existingPath,
            },
          },
        ]),
      }
    }

    if (assistantCount === 3) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_upgrade_existing_memory',
            name: 'Write',
            input: {
              file_path: existingPath,
              content: this.newMemoryContent,
            },
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'memory extraction complete'),
    }
  }
}

class ForgetMemoryClient implements LlmClient {
  readonly providerName = 'capture'
  requests: CreateMessageRequest[] = []
  private memoryDir?: string

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    const assistantCount = request.messages.filter(
      message => message.role === 'assistant',
    ).length
    this.memoryDir ??= getTextContent(
      request.messages.at(-1) ?? createTextMessage('user', ''),
    )
      .match(/Memory directory: (.+)/)?.[1]?.trim()

    const entrypointPath = this.memoryDir
      ? join(this.memoryDir, 'MEMORY.md')
      : '/placeholder'
    const memoryFilePath = this.memoryDir
      ? join(this.memoryDir, 'feedback', 'terse-responses.md')
      : '/placeholder'

    if (assistantCount === 1) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_read_memory_file',
            name: 'Read',
            input: { file_path: memoryFilePath },
          },
          {
            type: 'tool_use',
            id: 'tool_read_memory_index',
            name: 'Read',
            input: { file_path: entrypointPath },
          },
        ]),
      }
    }

    if (assistantCount === 2) {
      return {
        message: createMessage('assistant', [
          {
            type: 'tool_use',
            id: 'tool_delete_memory_file',
            name: 'DeleteMemory',
            input: { file_path: memoryFilePath },
          },
          {
            type: 'tool_use',
            id: 'tool_update_memory_index',
            name: 'Write',
            input: {
              file_path: entrypointPath,
              content: '# Memory\n\n',
            },
          },
        ]),
      }
    }

    return {
      message: createTextMessage('assistant', 'forgotten memory removed'),
    }
  }
}

function createConversationMessages(): Message[] {
  return [
    createTextMessage('user', 'Please remember that I prefer terse responses.'),
    createTextMessage('assistant', 'I will keep responses terse from now on.'),
  ]
}

async function seedMemoryFile(input: {
  workspaceRoot: string
  env: NodeJS.ProcessEnv
  relativePath: string
  name: string
  description: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  body: string
}) {
  await ensureMemoryScaffold(input.workspaceRoot, input.env)
  const filePath = getMemoryFilePath(
    input.workspaceRoot,
    input.relativePath,
    input.env,
  )
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    formatMemoryDocument(
      {
        name: input.name,
        description: input.description,
        type: input.type,
        updated_at: '2026-04-20T10:00:00.000Z',
      },
      input.body,
    ),
    'utf8',
  )
}

test('automatic memory extractor writes memory files inside the workspace memory dir', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-extract-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')
  const client = new SuccessfulExtractionClient()
  const extractor = createAutomaticMemoryExtractor({
    client,
    model: 'stub-model',
    workspaceRoot,
    env,
  })

  try {
    const appended = await extractor.extractTurn({
      userPrompt: 'Please remember that I prefer terse responses.',
      messages: createConversationMessages(),
      systemPrompt: 'BASE SYSTEM PROMPT',
    })

    const memoryFile = await readFile(
      getMemoryFilePath(workspaceRoot, 'feedback/terse-responses.md', env),
      'utf8',
    )
    const memoryIndex = await readFile(
      getMemoryEntrypointPath(workspaceRoot, env),
      'utf8',
    )

    assert.equal(appended.length, 1)
    assert.match(getTextContent(appended[0]!), /Saved 1 memory file/)
    assert.match(memoryFile, /type: feedback/)
    assert.match(memoryFile, /Keep answers terse/)
    assert.match(memoryIndex, /\[Terse Responses\]\(feedback\/terse-responses\.md\)/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('automatic memory extractor rejects writes outside the memory dir', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-extract-escape-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')
  const client = new EscapingExtractionClient()
  const extractor = createAutomaticMemoryExtractor({
    client,
    model: 'stub-model',
    workspaceRoot,
    env,
  })

  try {
    const appended = await extractor.extractTurn({
      userPrompt: 'Remember this.',
      messages: createConversationMessages(),
      systemPrompt: 'BASE SYSTEM PROMPT',
    })

    assert.equal(appended.length, 0)
    await assert.rejects(readFile('/tmp/escape-memory.md', 'utf8'))
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('automatic memory extractor redirects same-name writes to the existing memory file', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-extract-upgrade-name-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')
  const existingRelativePath = 'feedback/terse-responses.md'
  const duplicateRelativePath = 'feedback/brief-answers.md'
  const upgradedContent = formatMemoryDocument(
    {
      name: 'Terse Responses',
      description: 'User prefers terse responses with no padded recap.',
      type: 'feedback',
      updated_at: '2026-04-20T12:00:00.000Z',
    },
    'Keep answers terse and avoid padded recap sections.',
  )
  const client = new DuplicateUpgradeClient(
    existingRelativePath,
    duplicateRelativePath,
    upgradedContent,
  )
  const extractor = createAutomaticMemoryExtractor({
    client,
    model: 'stub-model',
    workspaceRoot,
    env,
  })

  try {
    await seedMemoryFile({
      workspaceRoot,
      env,
      relativePath: existingRelativePath,
      name: 'Terse Responses',
      description: 'User prefers concise replies.',
      type: 'feedback',
      body: 'Keep answers concise.',
    })

    const appended = await extractor.extractTurn({
      userPrompt: 'Please remember that I prefer terse responses with no padded recap.',
      messages: createConversationMessages(),
      systemPrompt: 'BASE SYSTEM PROMPT',
    })

    const upgradedMemory = await readFile(
      getMemoryFilePath(workspaceRoot, existingRelativePath, env),
      'utf8',
    )

    await assert.rejects(
      readFile(getMemoryFilePath(workspaceRoot, duplicateRelativePath, env), 'utf8'),
    )
    assert.equal(appended.length, 1)
    assert.match(getTextContent(appended[0]!), /Saved 1 memory file/)
    assert.match(upgradedMemory, /no padded recap/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('automatic memory extractor redirects uniquely similar descriptions to the existing memory file', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-extract-upgrade-desc-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')
  const existingRelativePath = 'feedback/answer-style.md'
  const duplicateRelativePath = 'feedback/brief-answers.md'
  const upgradedContent = formatMemoryDocument(
    {
      name: 'Brief Answers',
      description: 'User prefers terse responses and no padded recap.',
      type: 'feedback',
      updated_at: '2026-04-20T12:00:00.000Z',
    },
    'Keep answers terse and avoid recap padding.',
  )
  const client = new DuplicateUpgradeClient(
    existingRelativePath,
    duplicateRelativePath,
    upgradedContent,
  )
  const extractor = createAutomaticMemoryExtractor({
    client,
    model: 'stub-model',
    workspaceRoot,
    env,
  })

  try {
    await seedMemoryFile({
      workspaceRoot,
      env,
      relativePath: existingRelativePath,
      name: 'Answer Style',
      description: 'User prefers terse responses with no padded recap.',
      type: 'feedback',
      body: 'Keep answers terse.',
    })

    const appended = await extractor.extractTurn({
      userPrompt: 'Please remember that I prefer terse responses and no padded recap.',
      messages: createConversationMessages(),
      systemPrompt: 'BASE SYSTEM PROMPT',
    })

    const upgradedMemory = await readFile(
      getMemoryFilePath(workspaceRoot, existingRelativePath, env),
      'utf8',
    )

    await assert.rejects(
      readFile(getMemoryFilePath(workspaceRoot, duplicateRelativePath, env), 'utf8'),
    )
    assert.equal(appended.length, 1)
    assert.match(getTextContent(appended[0]!), /Saved 1 memory file/)
    assert.match(upgradedMemory, /Keep answers terse and avoid recap padding/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('automatic memory extractor handles explicit forget by deleting memory and updating index', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-extract-forget-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')
  const memoryRelativePath = 'feedback/terse-responses.md'
  const client = new ForgetMemoryClient()
  const extractor = createAutomaticMemoryExtractor({
    client,
    model: 'stub-model',
    workspaceRoot,
    env,
  })

  try {
    await seedMemoryFile({
      workspaceRoot,
      env,
      relativePath: memoryRelativePath,
      name: 'Terse Responses',
      description: 'User prefers concise replies.',
      type: 'feedback',
      body: 'Keep answers terse.',
    })
    await writeFile(
      getMemoryEntrypointPath(workspaceRoot, env),
      [
        '# Memory',
        '',
        '- [Terse Responses](feedback/terse-responses.md) - User prefers concise replies.',
        '',
      ].join('\n'),
      'utf8',
    )

    const appended = await extractor.extractTurn({
      userPrompt: 'Forget that I prefer terse responses.',
      messages: [
        createTextMessage('user', 'Forget that I prefer terse responses.'),
        createTextMessage('assistant', 'I will remove that memory.'),
      ],
      systemPrompt: 'BASE SYSTEM PROMPT',
    })

    const memoryIndex = await readFile(
      getMemoryEntrypointPath(workspaceRoot, env),
      'utf8',
    )

    await assert.rejects(
      readFile(getMemoryFilePath(workspaceRoot, memoryRelativePath, env), 'utf8'),
    )
    assert.equal(appended.length, 1)
    assert.match(getTextContent(appended[0]!), /Updated 1 memory file/)
    assert.doesNotMatch(memoryIndex, /terse-responses\.md/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('automatic memory extractor can run in background and flush on drain', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-memory-extract-background-'))
  const env = { ...process.env, HOME: homeDir }
  const workspaceRoot = join(homeDir, 'workspace')
  const client = new DelayedSuccessfulExtractionClient(30)
  const extractor = createAutomaticMemoryExtractor({
    client,
    model: 'stub-model',
    workspaceRoot,
    env,
  })
  const appended: Message[] = []

  try {
    const start = Date.now()
    extractor.scheduleExtractTurn({
      state: {
        userPrompt: 'Please remember that I prefer terse responses.',
        messages: createConversationMessages(),
        systemPrompt: 'BASE SYSTEM PROMPT',
      },
      onMessages(messages) {
        appended.push(...messages)
      },
    })
    const elapsedMs = Date.now() - start

    assert.equal(appended.length, 0)
    assert.ok(elapsedMs < 20)

    await extractor.drainPendingExtraction()

    const memoryFile = await readFile(
      getMemoryFilePath(workspaceRoot, 'feedback/terse-responses.md', env),
      'utf8',
    )

    assert.equal(appended.length, 1)
    assert.match(getTextContent(appended[0]!), /Saved 1 memory file/)
    assert.match(memoryFile, /Keep answers terse/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
