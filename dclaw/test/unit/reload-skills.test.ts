import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executeSingleTurn } from '../../src/core/queryLoop.js'
import type {
  CreateMessageRequest,
  CreateMessageResponse,
  LlmClient,
} from '../../src/llm/types.js'
import { loadSkills } from '../../src/skills/loader.js'
import { createSkillRegistry } from '../../src/skills/registry.js'
import { createDefaultToolRegistry } from '../../src/tools/index.js'
import { reloadSkillsTool } from '../../src/tools/builtin/reloadSkills.js'
import { skillTool } from '../../src/tools/builtin/skill.js'
import { createTextMessage, createToolUseMessage, getTextContent } from '../../src/types/message.js'
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

class InstallThenReloadThenUseClient implements LlmClient {
  readonly providerName = 'reload-skills-test'
  readonly requests: CreateMessageRequest[] = []

  constructor(private readonly command: string) {}

  async createMessage(
    request: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    this.requests.push(request)

    switch (this.requests.length) {
      case 1:
        return {
          message: createToolUseMessage('assistant', 'Bash', {
            command: this.command,
            description: 'Create a new skill in the workspace skill directory.',
            dangerouslyDisableSandbox: true,
          }),
        }
      case 2:
        return {
          message: createToolUseMessage('assistant', 'ReloadSkills', {}),
        }
      case 3:
        return {
          message: createToolUseMessage('assistant', 'Skill', {
            skill_name: 'agent-browser',
          }),
        }
      default: {
        const reminder = request.messages.find(message =>
          getTextContent(message).includes('name: agent-browser'),
        )
        assert.ok(reminder)

        return {
          message: createTextMessage(
            'assistant',
            'continued with skill agent-browser',
          ),
        }
      }
    }
  }
}

test('ReloadSkills refreshes the current skill registry and exposes newly added project skills', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-reload-skills-'))

  try {
    const context = createToolContext({
      cwd: workspaceDir,
      skillRegistry: createSkillRegistry(
        await loadSkills({
          cwd: workspaceDir,
        }),
      ),
    })

    assert.equal(reloadSkillsTool.isEnabled(context), false)
    assert.deepEqual(await skillTool.validate({ skill_name: 'agent-browser' }, context), {
      ok: false,
      error: 'Unknown skill: agent-browser',
    })

    context.reloadSkills = async () => {
      context.skillRegistry = createSkillRegistry(
        await loadSkills({
          cwd: workspaceDir,
        }),
      )

      return {
        reloaded: true,
        totalSkills: context.skillRegistry.list().length,
        skillNames: context.skillRegistry
          .list()
          .map(skill => skill.name)
          .sort((left, right) => left.localeCompare(right)),
      }
    }

    assert.equal(reloadSkillsTool.isEnabled(context), true)

    await writeSkill(join(workspaceDir, '.dclaw', 'skills', 'agent-browser.md'), {
      name: 'agent-browser',
      description: 'Automate a browser from the terminal.',
      prompt: 'Use browser automation when web interaction is required.',
    })

    const reloadResult = await reloadSkillsTool.call({}, context)
    assert.equal(reloadResult.ok, true)
    assert.equal(reloadResult.output.reloaded, true)
    assert.ok(reloadResult.output.skillNames.includes('agent-browser'))
    assert.ok((context.skillRegistry?.get('agent-browser')))

    const skillResult = await skillTool.call(
      { skill_name: 'agent-browser' },
      context,
    )

    assert.equal(skillResult.ok, true)
    assert.equal(skillResult.output.skill.name, 'agent-browser')
    assert.equal(skillResult.output.skill.source, 'project')
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('query loop can create a new skill, reload skills, and immediately use it in the same conversation', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'dclaw-reload-query-loop-'))

  try {
    let skillRegistry = createSkillRegistry(
      await loadSkills({
        cwd: workspaceDir,
      }),
    )

    const toolRegistry = createDefaultToolRegistry()
    const toolContext = createToolContext({
      cwd: workspaceDir,
      permissionMode: 'bypass-permissions',
      availableTools: toolRegistry.list().map(tool => tool.name),
      skillRegistry,
    })

    toolContext.reloadSkills = async () => {
      skillRegistry = createSkillRegistry(
        await loadSkills({
          cwd: workspaceDir,
        }),
      )
      toolContext.skillRegistry = skillRegistry

      return {
        reloaded: true,
        totalSkills: skillRegistry.list().length,
        skillNames: skillRegistry
          .list()
          .map(skill => skill.name)
          .sort((left, right) => left.localeCompare(right)),
      }
    }

    const command = [
      'mkdir -p .dclaw/skills',
      "cat > .dclaw/skills/agent-browser.md <<'EOF'",
      '---',
      'name: "agent-browser"',
      'description: "Automate a browser from the terminal."',
      '---',
      '',
      'Use browser automation when web interaction is required.',
      'EOF',
    ].join('\n')

    const client = new InstallThenReloadThenUseClient(command)
    const result = await executeSingleTurn({
      client,
      messages: [createTextMessage('user', 'install and use the agent-browser skill')],
      toolRegistry,
      toolContext,
    })

    assert.equal(result.outputText, 'continued with skill agent-browser')
    assert.ok(toolContext.skillRegistry?.get('agent-browser'))
    assert.equal(client.requests.length, 4)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
