---
name: install-skills
description: Use when the user wants to find, install, or enable skills from local skill directories or from SkillHub.
context: inline
---

# Install Skills

Use this skill when the user wants to search for, install, or enable a skill.

## Core Rule

Always check local skills first before using any external skill store.

If the requested skill already exists locally:

- do not reinstall it
- use the existing skill directly with the `Skill` tool

Only continue to external installation when no suitable local skill already exists.

## Local-First Workflow

### 1. Inspect currently available skills

- Call `ListLoadedSkills` to inspect the current skill list already loaded in runtime.
- Look for:
  - exact name matches
  - obvious builtin matches
  - obvious user/project matches

If a suitable skill already exists:

- tell the user it is already available
- call the `Skill` tool with the existing skill name when appropriate
- stop the installation flow

### 2. Decide the source only when local skills are insufficient

If local skills do not satisfy the request, continue with SkillHub as the supported external source for this workflow.

## External Installation Rules

### 3. Check whether the store CLI is installed

Before installation:

- verify whether the provider CLI already exists
- if it does not exist, read the official installation instructions first
- then install only the CLI

Do not install extra default add-ons unless the user explicitly asks for them.

### 4. Always install to dclaw-managed directories

Never rely on the store CLI default install directory such as `./skills`.

Always install into one of these directories:

- workspace install: `<cwd>/.dclaw/skills`
- user install: `~/.dclaw/skills`

Default target:

- if the user does not specify global/shared/public install, use workspace install
- if the user explicitly asks for global/shared/public install, use user install

### 5. Prefer official documentation before installation

If the user references an installation page or if the CLI is missing:

- use `WebFetch` to read the official install guide
- follow the official documented install path
- keep the install command targeted and minimal

## Provider-Specific Guidance

### SkillHub

Use this path when the user explicitly asks for `skillhub`, or when SkillHub is the intended source.

Current verified behavior:

- SkillHub provides an official install document
- SkillHub supports CLI-only installation
- SkillHub CLI supports an explicit install root via `--dir`

Recommended workflow:

1. Check whether `skillhub` exists.
2. If it does not exist:
   - fetch `https://skillhub.cn/install/skillhub.md`
   - install CLI only
3. Install the skill with an explicit target directory.

Typical commands:

```bash
command -v skillhub
```

```bash
curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only
```

Workspace install:

```bash
mkdir -p .dclaw/skills
skillhub --dir .dclaw/skills install <skill-slug>
```

User install:

```bash
mkdir -p ~/.dclaw/skills
skillhub --dir ~/.dclaw/skills install <skill-slug>
```

## Required Post-Install Step

After adding skills to the filesystem, you must call:

- `ReloadSkills`

Only after `ReloadSkills` succeeds should you assume the new skill is available in the current conversation.

## Tooling Guidance

- Use `Skill` to activate existing local skills.
- Use `ListLoadedSkills` before external installation flows so local skills can be reused.
- Use `WebFetch` to read official store installation pages or skill detail pages.
- Use `Bash` to:
  - check whether a store CLI exists
  - run CLI-only installation when needed
  - install the skill with an explicit target directory
- Use `ReloadSkills` immediately after installation.

## Important Constraints

- Do not guess unknown skill names if the user asked for a specific skill; prefer exact matches.
- Do not reinstall a skill that is already available locally.
- Do not install into the store default directory.
- Do not assume an installed skill is available until `ReloadSkills` completes.
- If the external store returns multiple ambiguous candidates, summarize them clearly and ask the user to choose.

## Example Behaviors

### Existing local skill

If the user says:

> Install the pdf skill

And `pdf` already exists locally:

- do not use an external store
- use the local `pdf` skill

### External install with SkillHub

If the user says:

> First check whether SkillHub is installed. If not, install only the CLI, then install agent-browser.

Then the expected path is:

1. check whether `skillhub` exists
2. if missing, fetch the official install doc and install CLI-only
3. install `agent-browser` into `.dclaw/skills` or `~/.dclaw/skills`
4. call `ReloadSkills`
5. continue with the newly available skill if needed
