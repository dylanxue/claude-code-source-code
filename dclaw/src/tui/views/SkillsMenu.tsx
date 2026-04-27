import React from 'react'
import { Box, Text } from 'ink'
import type { SkillStatus } from '../../skills/enablement.js'

export type SkillsMenuMode = 'root' | 'list' | 'configure'

export type SkillsMenuState = {
  errorText?: string
  isLoading: boolean
  mode: SkillsMenuMode
  searchQuery: string
  selectedIndex: number
  skills: SkillStatus[]
}

type Props = {
  menu: SkillsMenuState
}

const MAX_VISIBLE_SKILLS = 8

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function getSkillDisplayName(skill: SkillStatus): string {
  const rawName = skill.name.includes(':')
    ? skill.name.split(':').at(-1) ?? skill.name
    : skill.name

  return rawName
    .replace(/^gh-/u, '')
    .split(/[-_]/u)
    .filter(Boolean)
    .map(part => {
      const upper = part.toUpperCase()
      if (['ci', 'pdf', 'cli', 'api', 'pr'].includes(part.toLowerCase())) {
        return upper
      }
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
    })
    .join(' ')
}

function getSkillTypeLabel(skill: SkillStatus): string {
  if (skill.name.includes(':')) {
    return 'Plugin'
  }

  return 'Skill'
}

export function filterSkills(
  skills: SkillStatus[],
  searchQuery: string,
): SkillStatus[] {
  const query = normalize(searchQuery)
  const sorted = [...skills].sort((left, right) =>
    getSkillDisplayName(left).localeCompare(getSkillDisplayName(right)),
  )

  if (!query) {
    return sorted
  }

  return sorted.filter(skill =>
    [
      skill.name,
      getSkillDisplayName(skill),
      skill.description,
      skill.source,
      skill.context,
    ]
      .filter((value): value is string => Boolean(value))
      .some(value => normalize(value).includes(query)),
  )
}

function getVisibleWindowStart(
  selectedIndex: number,
  itemCount: number,
): number {
  if (itemCount <= MAX_VISIBLE_SKILLS) {
    return 0
  }

  return Math.min(
    Math.max(selectedIndex - MAX_VISIBLE_SKILLS + 1, 0),
    itemCount - MAX_VISIBLE_SKILLS,
  )
}

function RootMenu({ selectedIndex }: { selectedIndex: number }) {
  const options = [
    {
      label: 'List available skills',
      description: 'Find a skill and insert its name into the input.',
    },
    {
      label: 'Enable/Disable skills',
      description: 'Turn skills on or off.',
    },
  ]

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>Skills</Text>
      <Text dimColor>Choose how you want to work with skills.</Text>
      <Box height={1} />
      {options.map((option, index) => (
        <Text key={option.label} color={index === selectedIndex ? 'cyan' : undefined}>
          {`${index === selectedIndex ? '›' : ' '} ${option.label}  ${option.description}`}
        </Text>
      ))}
      <Box height={1} />
      <Text dimColor>Press enter to select or esc to close</Text>
    </Box>
  )
}

function SkillsList({
  configure,
  menu,
}: {
  configure: boolean
  menu: SkillsMenuState
}) {
  const skills = filterSkills(menu.skills, menu.searchQuery)
  const windowStart = getVisibleWindowStart(menu.selectedIndex, skills.length)
  const visibleSkills = skills.slice(windowStart, windowStart + MAX_VISIBLE_SKILLS)

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold>{configure ? 'Enable/Disable Skills' : 'Available Skills'}</Text>
      <Text dimColor>
        {configure
          ? 'Turn skills on or off. Your changes are saved automatically.'
          : 'Select a skill to insert its name into the input.'}
      </Text>
      <Box height={1} />
      <Text dimColor>Type to search skills</Text>
      <Text>{`> ${menu.searchQuery}`}</Text>
      <Box height={1} />
      {menu.isLoading ? <Text dimColor>Loading skills...</Text> : null}
      {menu.errorText ? <Text color="red">{menu.errorText}</Text> : null}
      {!menu.isLoading && !menu.errorText && visibleSkills.length === 0 ? (
        <Text dimColor>No matching skills</Text>
      ) : null}
      {visibleSkills.map((skill, index) => {
        const absoluteIndex = windowStart + index
        const isActive = absoluteIndex === menu.selectedIndex
        const enabledPrefix = skill.enabled ? '[x]' : '[ ]'
        const prefix = configure ? `${enabledPrefix} ` : ''
        const typeLabel = `[${getSkillTypeLabel(skill)}]`
        return (
          <Text key={skill.name} color={isActive ? 'cyan' : undefined} wrap="truncate-end">
            {`${isActive ? '›' : ' '} ${prefix}${getSkillDisplayName(skill).padEnd(28)} ${typeLabel} ${skill.description}`}
          </Text>
        )
      })}
      <Box height={1} />
      <Text dimColor>
        {configure
          ? 'Press enter to toggle, type to search, or esc to close'
          : 'Press enter to insert, type to search, or esc to close'}
      </Text>
    </Box>
  )
}

export function SkillsMenu({ menu }: Props) {
  if (menu.mode === 'root') {
    return <RootMenu selectedIndex={menu.selectedIndex} />
  }

  return <SkillsList configure={menu.mode === 'configure'} menu={menu} />
}
