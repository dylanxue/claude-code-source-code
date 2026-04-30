import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import { loadAgentMessages } from '../../src/agent/session.js'
import { loadAgent } from '../../src/agent/store.js'
import { loadSkills } from '../../src/skills/loader.js'
import { createSkillRegistry } from '../../src/skills/registry.js'
import { listInvokedSkills } from '../../src/skills/state.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { skillTool } from '../../src/tools/builtin/skill.js'
import { PROMPT as SKILL_TOOL_PROMPT } from '../../src/tools/builtin/skillPrompt.js'
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
    context?: 'inline' | 'fork'
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
      ...(input.context ? [`context: ${JSON.stringify(input.context)}`] : []),
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
    private readonly expectedSource: 'builtin' | 'user' | 'project',
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

class InstallIntentCaptureClient implements LlmClient {
  readonly providerName = 'skill-test'
  readonly requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createTextMessage('assistant', 'ok'),
    }
  }
}

class ForkSkillClient implements LlmClient {
  readonly providerName = 'skill-test'
  readonly requests: CreateMessageRequest[] = []

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)
    return {
      message: createTextMessage('assistant', 'forked skill completed'),
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
  assert.equal(result.output.applied, true)
  assert.equal(result.output.execution_context, 'inline')
  assert.deepEqual(result.output.skill, {
    name: 'review',
    description: 'Inspect a proposed change before shipping.',
    source: 'builtin',
    path: '/tmp/review.md',
  })
  assert.equal(result.newMessages?.length, 1)
  assert.equal(result.newMessages?.[0]?.runtimeAttachment?.type, 'invoked_skills')
  assert.equal(result.newMessages?.[0]?.runtimeVisibility?.transcript, false)
  assert.match(
    getTextContent(result.newMessages?.[0]!),
    /Apply the following skill while continuing the current task/,
  )
  assert.match(getTextContent(result.newMessages?.[0]!), /name: review/)
  assert.deepEqual(
    listInvokedSkills(context.invokedSkills).map(skill => ({
      name: skill.name,
      source: skill.source,
      path: skill.path,
    })),
    [
      {
        name: 'review',
        source: 'builtin',
        path: '/tmp/review.md',
      },
    ],
  )
})

test('Skill tool can execute a forked skill through the subagent runtime', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-tool-fork-home-'))
  const env = { ...process.env, HOME: homeDir }
  const registry = createSkillRegistry([
    {
      name: 'review',
      description: 'Inspect a proposed change before shipping.',
      source: 'builtin',
      prompt: 'Review the current work carefully.',
      context: 'fork',
      path: '/tmp/review.md',
    },
  ])
  const toolRegistry = createDefaultToolRegistry()
  const client = new ForkSkillClient()
  const context = createToolContext({
    sessionId: 'session-skill-fork',
    activeTurnId: 'turn-skill-fork',
    cwd: '/tmp/project',
    availableTools: toolRegistry.list().map(tool => tool.name),
    skillRegistry: registry,
    agentRuntime: {
      client,
      provider: 'stub',
      model: 'stub-model',
      cwd: '/tmp/project',
      env,
      permissionMode: 'default',
      availableTools: toolRegistry.list().map(tool => tool.name),
      toolRegistry,
      skillRegistry: registry,
    },
  })

  try {
    const result = await skillTool.call(
      {
        skill_name: 'review',
      },
      context,
    )

    assert.equal(result.newMessages?.length ?? 0, 0)
    assert.equal(result.output.applied, true)
    assert.equal(result.output.execution_context, 'fork')
    assert.deepEqual(result.output.skill, {
      name: 'review',
      description: 'Inspect a proposed change before shipping.',
      source: 'builtin',
      path: '/tmp/review.md',
      context: 'fork',
    })
    assert.equal(result.output.agent?.status, 'completed')
    assert.equal(result.output.result?.output_text, 'forked skill completed')
    assert.equal(listInvokedSkills(context.invokedSkills).length, 0)
    assert.equal(client.requests.length, 1)
    assert.match(
      getTextContent(client.requests[0]!.messages[0]!),
      /# Skill\nname: review/,
    )

    const agentId = result.output.agent?.agent_id
    assert.ok(agentId)
    const storedAgent = await loadAgent(agentId, 'session-skill-fork', env)
    assert.equal(storedAgent?.status, 'completed')
    const messages = await loadAgentMessages('session-skill-fork', agentId, env)
    assert.ok(messages.length >= 2)
    const transcriptText = messages.map(message => getTextContent(message)).join('\n')
    assert.match(transcriptText, /Review the current work carefully\./)
    assert.match(transcriptText, /forked skill completed/)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test('Skill tool ignores fork execution and applies the skill inline inside a subagent', async () => {
  const registry = createSkillRegistry([
    {
      name: 'review',
      description: 'Inspect a proposed change before shipping.',
      source: 'builtin',
      prompt: 'Review the current work carefully.',
      context: 'fork',
      path: '/tmp/review.md',
    },
  ])
  const toolRegistry = createDefaultToolRegistry()
  const context = createToolContext({
    sessionId: undefined,
    activeTurnId: 'turn-subagent-inline-skill',
    availableTools: toolRegistry.list().map(tool => tool.name),
    skillRegistry: registry,
    agentRuntime: {
      client: new ForkSkillClient(),
      provider: 'stub',
      model: 'stub-model',
      cwd: '/tmp/project',
      permissionMode: 'default',
      availableTools: toolRegistry.list().map(tool => tool.name),
      toolRegistry,
      skillRegistry: registry,
      parentSessionId: 'session-parent',
      currentAgentId: 'agent_parent',
    },
  })

  const result = await skillTool.call(
    {
      skill_name: 'review',
    },
    context,
  )

  assert.equal(result.summary, 'Applied skill review')
  assert.equal(result.output.applied, true)
  assert.equal(result.output.execution_context, 'inline')
  assert.equal(result.output.agent, undefined)
  assert.equal(result.newMessages?.length, 1)
  assert.match(
    getTextContent(result.newMessages?.[0]!),
    /Apply the following skill while continuing the current task/,
  )
  assert.deepEqual(
    listInvokedSkills(context.invokedSkills).map(skill => ({
      name: skill.name,
      source: skill.source,
      path: skill.path,
    })),
    [
      {
        name: 'review',
        source: 'builtin',
        path: '/tmp/review.md',
      },
    ],
  )
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

test('repository builtin document skills are loadable through the skill registry', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-tool-repo-builtin-'))

  try {
    const registry = createSkillRegistry(
      await loadSkills({
        cwd: tempDir,
      }),
    )

    assert.ok(registry.get('pdf'))
    assert.ok(registry.get('doc'))
    assert.ok(registry.get('spreadsheet'))

    const result = await skillTool.call(
      { skill_name: 'pdf' },
      createToolContext({
        cwd: tempDir,
        skillRegistry: registry,
      }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output.skill.name, 'pdf')
    assert.equal(result.output.skill.source, 'builtin')
    assert.match(result.summary ?? '', /Applied skill pdf/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('Skill tool prompt tells the model how to follow unsupported document results', () => {
  assert.match(
    SKILL_TOOL_PROMPT,
    /When Read or WebFetch returns structured unsupported content for a document/i,
  )
  assert.match(
    SKILL_TOOL_PROMPT,
    /prefer the builtin `install-skills` skill first/i,
  )
  assert.match(
    SKILL_TOOL_PROMPT,
    /checking local skills before any external install flow/i,
  )
  assert.match(SKILL_TOOL_PROMPT, /`pdf` for PDF documents/)
  assert.match(SKILL_TOOL_PROMPT, /`doc` for `.doc` and `.docx`/i)
  assert.match(
    SKILL_TOOL_PROMPT,
    /`spreadsheet` for `.csv`, `.tsv`, `.xls`, `.xlsx`/i,
  )
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

test('install intent exposes install-skills and reload guidance to the model-facing request', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-install-intent-'))
  const toolRegistry = createDefaultToolRegistry()

  try {
    const skillRegistry = createSkillRegistry(
      await loadSkills({
        cwd: tempDir,
      }),
    )
    const client = new InstallIntentCaptureClient()

    const result = await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'please install the agent-browser skill')],
      toolRegistry,
      toolContext: createToolContext({
        cwd: tempDir,
        availableTools: toolRegistry.list().map(tool => tool.name),
        skillRegistry,
        reloadSkills: async () => ({
          reloaded: true,
          totalSkills: skillRegistry.list().length,
          skillNames: skillRegistry.list().map(skill => skill.name),
        }),
      }),
    })

    assert.equal(result.outputText, 'ok')
    assert.equal(client.requests.length, 1)

    const request = client.requests[0]!
    const skillDefinition = request.tools?.find(tool => tool.name === 'Skill')
    assert.ok(skillDefinition)
    assert.match(
      skillDefinition?.description ?? '',
      /prefer the builtin `install-skills` skill first/i,
    )

    const reloadDefinition = request.tools?.find(
      tool => tool.name === 'ReloadSkills',
    )
    assert.ok(reloadDefinition)
    assert.match(
      reloadDefinition?.description ?? '',
      /become available in the current conversation immediately/i,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
