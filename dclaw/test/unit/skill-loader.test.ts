import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  findProjectSkillDirectories,
  loadSkills,
} from '../../src/skills/loader.js'
import { buildSkillPrompt } from '../../src/skills/prompt.js'
import { createSkillRegistry } from '../../src/skills/registry.js'

async function writeSkill(
  path: string,
  input: {
    name?: string
    description?: string
    prompt: string
  },
): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const lines = ['---']

  if (input.name) {
    lines.push(`name: ${JSON.stringify(input.name)}`)
  }
  if (input.description) {
    lines.push(`description: ${JSON.stringify(input.description)}`)
  }

  lines.push('---', '', input.prompt, '')
  await writeFile(path, lines.join('\n'), 'utf8')
}

test('loadSkills discovers builtin and project skills from the expected directories', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-loader-'))
  const builtinDir = join(tempDir, 'builtin')
  const workspaceDir = join(tempDir, 'workspace')
  const nestedCwd = join(workspaceDir, 'apps', 'api')

  try {
    await writeSkill(join(builtinDir, 'review.md'), {
      name: 'review',
      description: 'Inspect a change before shipping.',
      prompt: 'Review the proposed change carefully.',
    })
    await writeSkill(join(workspaceDir, '.dclaw', 'skills', 'deploy.md'), {
      name: 'deploy-check',
      description: 'Verify deploy readiness.',
      prompt: 'Check release notes, migrations, and rollback safety.',
    })
    await writeSkill(
      join(workspaceDir, 'apps', '.dclaw', 'skills', 'nested', 'handoff.md'),
      {
        name: 'handoff',
        description: 'Prepare a teammate handoff.',
        prompt: 'Summarize status, risks, and next steps.',
      },
    )
    await writeSkill(join(workspaceDir, '.dclaw', 'skills', 'invalid.md'), {
      description: 'Missing name should not load.',
      prompt: 'This should be skipped.',
    })

    const skills = await loadSkills({
      cwd: nestedCwd,
      builtinSkillsDir: builtinDir,
    })

    assert.deepEqual(
      skills.map(skill => ({
        name: skill.name,
        source: skill.source,
        prompt: skill.prompt,
      })),
      [
        {
          name: 'review',
          source: 'builtin',
          prompt: 'Review the proposed change carefully.',
        },
        {
          name: 'deploy-check',
          source: 'project',
          prompt: 'Check release notes, migrations, and rollback safety.',
        },
        {
          name: 'handoff',
          source: 'project',
          prompt: 'Summarize status, risks, and next steps.',
        },
      ],
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('findProjectSkillDirectories walks from the workspace root toward the cwd', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-dirs-'))
  const workspaceDir = join(tempDir, 'workspace')
  const nestedCwd = join(workspaceDir, 'apps', 'api')

  try {
    await mkdir(join(workspaceDir, '.dclaw', 'skills'), { recursive: true })
    await mkdir(join(workspaceDir, 'apps', '.dclaw', 'skills'), {
      recursive: true,
    })

    const directories = await findProjectSkillDirectories(nestedCwd)

    assert.deepEqual(directories, [
      join(workspaceDir, '.dclaw', 'skills'),
      join(workspaceDir, 'apps', '.dclaw', 'skills'),
    ])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('SkillRegistry resolves later project skills over earlier builtin skills', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-registry-'))
  const builtinDir = join(tempDir, 'builtin')
  const workspaceDir = join(tempDir, 'workspace')

  try {
    await writeSkill(join(builtinDir, 'review.md'), {
      name: 'review',
      description: 'Builtin review flow.',
      prompt: 'Use the builtin review process.',
    })
    await writeSkill(join(workspaceDir, '.dclaw', 'skills', 'review.md'), {
      name: 'review',
      description: 'Project-specific review flow.',
      prompt: 'Use the project-specific review checklist.',
    })

    const registry = createSkillRegistry(
      await loadSkills({
        cwd: workspaceDir,
        builtinSkillsDir: builtinDir,
      }),
    )

    assert.equal(registry.list().length, 1)
    assert.deepEqual(registry.get('review'), {
      name: 'review',
      description: 'Project-specific review flow.',
      source: 'project',
      prompt: 'Use the project-specific review checklist.',
      path: join(workspaceDir, '.dclaw', 'skills', 'review.md'),
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('buildSkillPrompt wraps a skill definition without inventing extra runtime state', () => {
  assert.equal(
    buildSkillPrompt({
      name: 'review',
      description: 'Inspect a change before shipping.',
      source: 'builtin',
      prompt: 'Review the proposed change carefully.',
    }),
    [
      '# Skill',
      'name: review',
      'description: Inspect a change before shipping.',
      '',
      'Review the proposed change carefully.',
    ].join('\n'),
  )
})
