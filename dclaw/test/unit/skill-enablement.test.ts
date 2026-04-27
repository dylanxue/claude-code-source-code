import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  const env = { ...process.env, HOME: homeDir }

  try {
    await setSkillEnabled('review', false, env)
    const disabled = await loadDisabledSkillNames(env)

    assert.deepEqual([...disabled], ['review'])
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

    await setSkillEnabled('review', true, env)
    assert.deepEqual([...(await loadDisabledSkillNames(env))], [])
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
