import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeMemoryProjectKey } from '../../src/memory/paths.js'
import {
  filterEnabledSkills,
  getSkillStatuses,
  loadDisabledSkillNames,
  setSkillEnabled,
} from '../../src/skills/enablement.js'
import type { LoadedSkill } from '../../src/skills/types.js'

const skills: LoadedSkill[] = [
  {
    name: 'review',
    description: 'Review code.',
    source: 'user',
    prompt: 'Review carefully.',
    path: '/tmp/review.md',
  },
  {
    name: 'pdf',
    description: 'Read PDFs.',
    source: 'builtin',
    prompt: 'Read PDF files.',
    path: '/tmp/pdf.md',
  },
]

test('skill enablement persists disabled skills and filters registries', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dclaw-skill-enablement-'))
  const workspaceRoot = join(homeDir, 'workspace project')
  const env = { ...process.env, HOME: homeDir } as NodeJS.ProcessEnv
  env.DCLAW_HOME = join(homeDir, '.dclaw')
  const statePath = join(
    homeDir,
    '.dclaw',
    'projects',
    sanitizeMemoryProjectKey(workspaceRoot),
    'skills-state.json',
  )

  try {
    await setSkillEnabled(workspaceRoot, 'review', false, env)
    const disabled = await loadDisabledSkillNames(workspaceRoot, env)

    assert.deepEqual([...disabled], ['review'])
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), {
      disabledSkills: ['review'],
    })
    assert.deepEqual(
      filterEnabledSkills(skills, disabled).map(skill => skill.name),
      ['pdf'],
    )
    assert.deepEqual(
      getSkillStatuses(skills, disabled).map(skill => ({
        name: skill.name,
        enabled: skill.enabled,
      })),
      [
        { name: 'review', enabled: false },
        { name: 'pdf', enabled: true },
      ],
    )

    await setSkillEnabled(workspaceRoot, 'review', true, env)
    assert.deepEqual([...(await loadDisabledSkillNames(workspaceRoot, env))], [])
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
