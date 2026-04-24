import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSystemPrompt } from '../../src/prompt/systemPrompt.js'
import { assemblePromptContext } from '../../src/prompt/contextAssembler.js'

test('buildSystemPrompt includes plan mode instructions and plan file context', () => {
  const prompt = buildSystemPrompt(
    assemblePromptContext({
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      mode: 'interactive',
      permissionMode: 'plan',
      plan: {
        boardId: 'board_123',
        status: 'active',
        planFilePath: '/tmp/.dclaw/plans/plan_board_123.md',
        boardTitle: 'Planning state work',
        boardPurpose: 'Refine the short-lived implementation batch.',
        boardPlan: 'Inspect current code, write a plan file, then wait.',
        currentTaskTitle: 'Implement planning state',
        currentStep: 'Writing the plan file scaffold',
        taskSummary: ['- [in_progress] Implement planning state'],
      },
    }),
  )

  assert.match(prompt, /# Planning State/)
  assert.match(prompt, /plan mode: active/)
  assert.match(prompt, /task board: board_123/)
  assert.match(prompt, /board title: Planning state work/)
  assert.match(prompt, /board purpose: Refine the short-lived implementation batch/)
  assert.match(prompt, /board plan: Inspect current code/)
  assert.match(prompt, /plan file: \/tmp\/.dclaw\/plans\/plan_board_123\.md/)
  assert.match(prompt, /only file you may edit during planning/)
  assert.match(prompt, /call ExitPlanMode to present it and wait for the user/)
  assert.match(prompt, /pending work summary:/)
})

test('buildSystemPrompt nudges complex work toward task tracking without globally forcing plan mode', () => {
  const prompt = buildSystemPrompt(
    assemblePromptContext({
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      mode: 'interactive',
      permissionMode: 'accept-edits',
    }),
  )

  assert.match(prompt, /TaskCreate and TaskUpdate/)
  assert.match(prompt, /# Task-Board Workflow/)
  assert.match(prompt, /plan_only requests/)
  assert.match(prompt, /implementation_with_planning requests/)
  assert.match(prompt, /EnterPlanMode is only for high_constraint_planning/)
  assert.match(prompt, /start execution without entering plan mode/)
  assert.doesNotMatch(prompt, /Prefer direct execution for simple requests/)
  assert.doesNotMatch(prompt, /# DCLAW\.md Instructions/)
})

test('buildSystemPrompt asks the model to follow the user language for reasoning and progress text', () => {
  const prompt = buildSystemPrompt(
    assemblePromptContext({
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      mode: 'interactive',
      permissionMode: 'accept-edits',
    }),
  )

  assert.match(prompt, /# Language/)
  assert.match(prompt, /Use the same language as the user's latest message/)
  assert.match(prompt, /reasoning\/thinking summaries/)
  assert.match(prompt, /pre-tool progress updates/)
})

test('buildSystemPrompt includes current date, environment, and git status context', () => {
  const prompt = buildSystemPrompt(
    assemblePromptContext({
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      mode: 'interactive',
      permissionMode: 'accept-edits',
      currentDate: '2026-04-22',
      environment: {
        platform: 'darwin',
        shell: 'bash',
        osVersion: 'Darwin 25.0.0',
        isGitRepository: true,
      },
      gitStatus: '## main\n M src/app.ts',
    }),
  )

  assert.match(prompt, /# Current Date/)
  assert.match(prompt, /today: 2026-04-22/)
  assert.match(prompt, /# Environment/)
  assert.match(prompt, /is git repository: yes/)
  assert.match(prompt, /platform: darwin/)
  assert.match(prompt, /shell: bash/)
  assert.match(prompt, /os version: Darwin 25.0.0/)
  assert.match(prompt, /# Git Status/)
  assert.match(prompt, /## main/)
  assert.match(prompt, /M src\/app\.ts/)
})

test('buildSystemPrompt includes recalled memory content with observable source paths', () => {
  const prompt = buildSystemPrompt(
    assemblePromptContext({
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      mode: 'interactive',
      permissionMode: 'accept-edits',
      memory: {
        memoryDir: '/tmp/.dclaw/projects/tmp-project/memory',
        entrypointPath: '/tmp/.dclaw/projects/tmp-project/memory/MEMORY.md',
        entrypointContent:
          '# Memory\n\n- [Migration Policy](project/migration-policy.md) - Validate PostgreSQL migrations.',
        entrypointWasTruncated: false,
        manifestCount: 3,
        recalledEntries: [
          {
            name: 'Migration Policy',
            description:
              'Validate PostgreSQL migrations against a real staging database.',
            type: 'project',
            updatedAt: '2026-04-20T10:00:00.000Z',
            path: '/tmp/.dclaw/projects/tmp-project/memory/project/migration-policy.md',
            relativePath: 'project/migration-policy.md',
            mtimeMs: 1,
            content: 'Avoid mock-only validation for migrations.',
            wasTruncated: false,
          },
        ],
      },
    }),
  )

  assert.match(prompt, /# Memory/)
  assert.match(prompt, /memory dir: \/tmp\/.dclaw\/projects\/tmp-project\/memory/)
  assert.match(prompt, /## MEMORY\.md/)
  assert.match(prompt, /path: \/tmp\/.dclaw\/projects\/tmp-project\/memory\/MEMORY\.md/)
  assert.match(prompt, /\[Migration Policy\]\(project\/migration-policy\.md\)/)
  assert.match(prompt, /recalled memories for this query: 1\/3/)
  assert.match(prompt, /path: \/tmp\/.dclaw\/projects\/tmp-project\/memory\/project\/migration-policy\.md/)
  assert.match(prompt, /Avoid mock-only validation for migrations\./)
})

test('buildSystemPrompt keeps MEMORY.md loaded even when no specific memories were recalled', () => {
  const prompt = buildSystemPrompt(
    assemblePromptContext({
      cwd: '/tmp/project',
      provider: 'stub',
      model: 'stub-model',
      mode: 'interactive',
      permissionMode: 'accept-edits',
      memory: {
        memoryDir: '/tmp/.dclaw/projects/tmp-project/memory',
        entrypointPath: '/tmp/.dclaw/projects/tmp-project/memory/MEMORY.md',
        entrypointContent:
          '# Memory\n\n- [User Roleplay Names](user-roleplay-names.md) - The user wants to be called 大壮 (Dazhuang).',
        entrypointWasTruncated: false,
        manifestCount: 1,
        recalledEntries: [],
      },
    }),
  )

  assert.match(prompt, /## MEMORY\.md/)
  assert.match(prompt, /User Roleplay Names/)
  assert.match(prompt, /recalled memories for this query: 0\/1/)
})
