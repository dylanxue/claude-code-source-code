import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  findProjectSkillDirectories,
  loadBuiltinSkills,
  loadUserSkills,
  loadSkills,
} from '../../src/skills/loader.js'
import { buildSkillPrompt } from '../../src/skills/prompt.js'
import { createSkillRegistry } from '../../src/skills/registry.js'

async function writeSkill(
  path: string,
  input: {
    name?: string
    description?: string
    context?: 'inline' | 'fork'
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
  if (input.context) {
    lines.push(`context: ${JSON.stringify(input.context)}`)
  }

  lines.push('---', '', input.prompt, '')
  await writeFile(path, lines.join('\n'), 'utf8')
}

test('loadSkills discovers builtin and project skills from the expected directories', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-loader-'))
  const builtinDir = join(tempDir, 'builtin')
  const homeDir = join(tempDir, 'home')
  const workspaceDir = join(tempDir, 'workspace')
  const nestedCwd = join(workspaceDir, 'apps', 'api')
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeSkill(join(builtinDir, 'review.md'), {
      name: 'review',
      description: 'Inspect a change before shipping.',
      context: 'fork',
      prompt: 'Review the proposed change carefully.',
    })
    await writeSkill(join(homeDir, '.dclaw', 'skills', 'common.md'), {
      name: 'common',
      description: 'Shared personal workflow.',
      prompt: 'Use the shared user-level checklist.',
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
      env,
    })

    assert.deepEqual(
      skills.map(skill => ({
        name: skill.name,
        source: skill.source,
        context: skill.context,
        prompt: skill.prompt,
      })),
      [
        {
          name: 'review',
          source: 'builtin',
          context: 'fork',
          prompt: 'Review the proposed change carefully.',
        },
        {
          name: 'common',
          source: 'user',
          context: undefined,
          prompt: 'Use the shared user-level checklist.',
        },
        {
          name: 'deploy-check',
          source: 'project',
          context: undefined,
          prompt: 'Check release notes, migrations, and rollback safety.',
        },
        {
          name: 'handoff',
          source: 'project',
          context: undefined,
          prompt: 'Summarize status, risks, and next steps.',
        },
      ],
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('loadUserSkills reads explicit ~/.dclaw/skills even when cwd is outside the home tree', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-user-skills-'))
  const homeDir = join(tempDir, 'home')
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeSkill(join(homeDir, '.dclaw', 'skills', 'common.md'), {
      name: 'common',
      description: 'Shared personal workflow.',
      prompt: 'Use the shared user-level checklist.',
    })

    const skills = await loadUserSkills(env)

    assert.deepEqual(
      skills.map(skill => ({
        name: skill.name,
        source: skill.source,
        prompt: skill.prompt,
      })),
      [
        {
          name: 'common',
          source: 'user',
          prompt: 'Use the shared user-level checklist.',
        },
      ],
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('findProjectSkillDirectories walks from the workspace root toward the cwd', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-dirs-'))
  const homeDir = join(tempDir, 'home')
  const workspaceDir = join(tempDir, 'workspace')
  const nestedCwd = join(workspaceDir, 'apps', 'api')
  const env = { ...process.env, HOME: homeDir }

  try {
    await mkdir(join(workspaceDir, '.dclaw', 'skills'), { recursive: true })
    await mkdir(join(workspaceDir, 'apps', '.dclaw', 'skills'), {
      recursive: true,
    })

    const directories = await findProjectSkillDirectories(nestedCwd, env)

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
  const homeDir = join(tempDir, 'home')
  const workspaceDir = join(tempDir, 'workspace')
  const env = { ...process.env, HOME: homeDir }

  try {
    await writeSkill(join(builtinDir, 'review.md'), {
      name: 'review',
      description: 'Builtin review flow.',
      prompt: 'Use the builtin review process.',
    })
    await writeSkill(join(homeDir, '.dclaw', 'skills', 'review.md'), {
      name: 'review',
      description: 'User-specific review flow.',
      prompt: 'Use the user-level review checklist.',
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
        env,
      }),
    )

    assert.equal(registry.list().length, 1)
    assert.deepEqual(registry.get('review'), {
      name: 'review',
      description: 'Project-specific review flow.',
      source: 'project',
      prompt: 'Use the project-specific review checklist.',
      context: undefined,
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

test('loadBuiltinSkills includes repository document skills', async () => {
  const skills = await loadBuiltinSkills()
  const names = skills.map(skill => skill.name).sort()

  assert.ok(names.includes('install-skills'))
  assert.ok(names.includes('pdf'))
  assert.ok(names.includes('doc'))
  assert.ok(names.includes('spreadsheet'))
  assert.equal(names.includes('document-quality-bar'), false)
  assert.equal(names.includes('render-and-review'), false)
  assert.equal(names.includes('extract-and-compare'), false)

  assert.match(
    skills.find(skill => skill.name === 'install-skills')?.prompt ?? '',
    /Always check local skills first/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'install-skills')?.prompt ?? '',
    /Call `ListLoadedSkills`/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'install-skills')?.prompt ?? '',
    /ReloadSkills/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'install-skills')?.prompt ?? '',
    /skillhub --dir \.dclaw\/skills install <skill-slug>/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'pdf')?.prompt ?? '',
    /document-quality-bar\.md/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'pdf')?.prompt ?? '',
    /references\/render-and-review\.md/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'pdf')?.prompt ?? '',
    /scripts\/inspect_pdf\.py/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'doc')?.prompt ?? '',
    /document-quality-bar\.md/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'doc')?.prompt ?? '',
    /references\/structure-and-extraction\.md/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'doc')?.prompt ?? '',
    /scripts\/inspect_docx\.py/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'spreadsheet')?.prompt ?? '',
    /document-quality-bar\.md/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'spreadsheet')?.prompt ?? '',
    /references\/workbook-overview\.md/i,
  )
  assert.match(
    skills.find(skill => skill.name === 'spreadsheet')?.prompt ?? '',
    /scripts\/inspect_workbook\.py/i,
  )
})
