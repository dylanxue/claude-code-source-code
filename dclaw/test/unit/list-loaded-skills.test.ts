import assert from 'node:assert/strict'
import test from 'node:test'
import { createSkillRegistry } from '../../src/skills/registry.js'
import { listLoadedSkillsTool } from '../../src/tools/builtin/listLoadedSkills.js'
import { createToolContext } from '../helpers/toolContext.js'

test('ListLoadedSkills validates availability from the current runtime', async () => {
  const context = createToolContext()

  assert.equal(listLoadedSkillsTool.isReadOnly({}), true)
  assert.deepEqual(await listLoadedSkillsTool.validate({}, context), {
    ok: false,
    error: 'ListLoadedSkills is not available in this runtime',
  })
})

test('ListLoadedSkills returns the loaded skills from the current runtime registry', async () => {
  const registry = createSkillRegistry([
    {
      name: 'install-skills',
      description: 'Find or install skills.',
      source: 'builtin',
      prompt: 'Use install-skills.',
      path: '/tmp/install-skills.md',
    },
    {
      name: 'agent-browser',
      description: 'Automate a browser.',
      source: 'project',
      prompt: 'Use browser automation.',
      context: 'fork',
      path: '/tmp/agent-browser.md',
    },
  ])

  const context = createToolContext({
    skillRegistry: registry,
  })

  const result = await listLoadedSkillsTool.call({}, context)

  assert.equal(result.ok, true)
  assert.equal(result.output.skills.length, 2)
  assert.deepEqual(result.output.skills, [
    {
      name: 'agent-browser',
      description: 'Automate a browser.',
      source: 'project',
      path: '/tmp/agent-browser.md',
      context: 'fork',
    },
    {
      name: 'install-skills',
      description: 'Find or install skills.',
      source: 'builtin',
      path: '/tmp/install-skills.md',
    },
  ])
  assert.match(result.summary ?? '', /agent-browser \(project\)/)
  assert.match(result.summary ?? '', /install-skills \(builtin\)/)
})
