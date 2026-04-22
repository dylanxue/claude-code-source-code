import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import { loadSkills } from '../../src/skills/loader.js'
import { createSkillRegistry } from '../../src/skills/registry.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { skillTool } from '../../src/tools/builtin/skill.js'
import {
  createTextMessage,
  createToolUseMessage,
  getTextContent,
  type Message,
} from '../../src/types/message.js'
import { createToolContext } from '../helpers/toolContext.js'

async function writeSkill(
  path: string,
  input: {
    name: string
    description: string
    prompt: string
  },
): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(
    path,
    [
      '---',
      `name: ${JSON.stringify(input.name)}`,
      `description: ${JSON.stringify(input.description)}`,
      '---',
      '',
      input.prompt,
      '',
    ].join('\n'),
    'utf8',
  )
}

class SkillContinuationClient implements LlmClient {
  readonly providerName = 'skill-test'
  readonly requests: CreateMessageRequest[] = []

  constructor(
    private readonly skillName: string,
    private readonly expectedSource: 'builtin' | 'project',
  ) {}

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    if (this.requests.length === 1) {
      return {
        message: createToolUseMessage('assistant', 'Skill', {
          skill_name: this.skillName,
        }),
      }
    }

    const reminder = request.messages.find(message =>
      getTextContent(message).includes('<system-reminder>'),
    )
    assert.ok(reminder)
    assert.match(getTextContent(reminder!), new RegExp(`name: ${this.skillName}`))
    assert.match(
      getTextContent(reminder!),
      new RegExp(`source: ${this.expectedSource}`),
    )

    return {
      message: createTextMessage(
        'assistant',
        `continued with skill ${this.skillName}`,
      ),
    }
  }
}

function getReminderMessages(messages: Message[]): Message[] {
  return messages.filter(message =>
    getTextContent(message).includes('<system-reminder>'),
  )
}

test('Skill tool validates and applies a loaded skill in the current context', async () => {
  const registry = createSkillRegistry([
    {
      name: 'review',
      description: 'Inspect a proposed change before shipping.',
      source: 'builtin',
      prompt: 'Review the current work carefully.',
      path: '/tmp/review.md',
    },
  ])
  const context = createToolContext({
    skillRegistry: registry,
  })

  assert.equal(skillTool.isEnabled(context), true)
  assert.deepEqual(await skillTool.validate({}, context), {
    ok: false,
    error: 'Skill requires a non-empty skill_name',
  })
  assert.deepEqual(
    await skillTool.validate({ skill_name: 'missing' }, context),
    {
      ok: false,
      error: 'Unknown skill: missing',
    },
  )

  const result = await skillTool.call(
    {
      skill_name: 'review',
    },
    context,
  )

  assert.equal(result.summary, 'Applied skill review')
  assert.deepEqual(result.output, {
    skill: {
      name: 'review',
      description: 'Inspect a proposed change before shipping.',
      source: 'builtin',
      path: '/tmp/review.md',
    },
    applied: true,
  })
  assert.equal(result.newMessages?.length, 1)
  assert.match(
    getTextContent(result.newMessages?.[0]!),
    /Apply the following skill while continuing the current task/,
  )
  assert.match(getTextContent(result.newMessages?.[0]!), /name: review/)
})

test('query loop can invoke a builtin skill and continue the conversation', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-tool-builtin-'))
  const builtinDir = join(tempDir, 'builtin')
  const workspaceDir = join(tempDir, 'workspace')
  const toolRegistry = createDefaultToolRegistry()

  try {
    await writeSkill(join(builtinDir, 'review.md'), {
      name: 'review',
      description: 'Inspect a proposed change before shipping.',
      prompt: 'Review the current work carefully.',
    })

    const skillRegistry = createSkillRegistry(
      await loadSkills({
        cwd: workspaceDir,
        builtinSkillsDir: builtinDir,
      }),
    )
    const client = new SkillContinuationClient('review', 'builtin')

    const result = await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'use the review skill')],
      toolRegistry,
      toolContext: createToolContext({
        cwd: workspaceDir,
        availableTools: toolRegistry.list().map(tool => tool.name),
        skillRegistry,
      }),
    })

    assert.equal(result.outputText, 'continued with skill review')
    assert.equal(client.requests.length, 2)
    assert.equal(getReminderMessages(result.addedMessages).length, 1)
    assert.match(
      getTextContent(getReminderMessages(result.addedMessages)[0]!),
      /source: builtin/,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('query loop can invoke a project skill and continue the conversation', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-tool-project-'))
  const workspaceDir = join(tempDir, 'workspace')
  const toolRegistry = createDefaultToolRegistry()

  try {
    await writeSkill(join(workspaceDir, '.dclaw', 'skills', 'handoff.md'), {
      name: 'handoff',
      description: 'Prepare a concise teammate handoff.',
      prompt: 'Summarize status, risks, and next steps.',
    })

    const skillRegistry = createSkillRegistry(
      await loadSkills({
        cwd: workspaceDir,
      }),
    )
    const client = new SkillContinuationClient('handoff', 'project')

    const result = await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'use the handoff skill')],
      toolRegistry,
      toolContext: createToolContext({
        cwd: workspaceDir,
        availableTools: toolRegistry.list().map(tool => tool.name),
        skillRegistry,
      }),
    })

    assert.equal(result.outputText, 'continued with skill handoff')
    assert.equal(client.requests.length, 2)
    assert.equal(getReminderMessages(result.addedMessages).length, 1)
    assert.match(
      getTextContent(getReminderMessages(result.addedMessages)[0]!),
      /source: project/,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
