import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { skillTool } from "../src/tools/skill.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-skill-tests");
const originalEnv = {
  HOME: process.env.HOME,
  CODEX_HOME: process.env.CODEX_HOME,
  DCLAW_HOME: process.env.DCLAW_HOME,
  CLAW_CONFIG_HOME: process.env.CLAW_CONFIG_HOME,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
};

afterEach(async () => {
  restoreEnv();
  await rm(tempRoot, { recursive: true, force: true });
});

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

test("Skill loads a SKILL.md from CODEX_HOME skills like claw-code", async () => {
  const codexHome = path.join(tempRoot, "codex-home");
  const skillPath = path.join(codexHome, "skills", "review", "SKILL.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(
    skillPath,
    [
      "---",
      "name: review",
      "---",
      "description: Review a code change carefully.",
      "# Review",
      "Check correctness first.",
    ].join("\n"),
    "utf8",
  );

  process.env.CODEX_HOME = codexHome;

  const result = await skillTool.execute(
    {
      skill: "review",
      args: "src/index.js",
    },
    { workspaceRoot },
  );

  assert.equal(result.skill, "review");
  assert.equal(result.path, skillPath);
  assert.equal(result.args, "src/index.js");
  assert.equal(result.description, "Review a code change carefully.");
  assert.match(result.prompt, /# Review/);
});

test("Skill resolves project-local .codex skills by frontmatter name", async () => {
  const nestedWorkspace = path.join(tempRoot, "workspace", "apps", "demo");
  const skillPath = path.join(tempRoot, "workspace", ".codex", "skills", "browser", "SKILL.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await mkdir(nestedWorkspace, { recursive: true });
  await writeFile(
    skillPath,
    [
      "---",
      'name: "playwright"',
      "---",
      "description: Automate a browser from the terminal.",
      "# Playwright",
    ].join("\n"),
    "utf8",
  );

  const result = await skillTool.execute(
    {
      skill: "$playwright",
    },
    { workspaceRoot: nestedWorkspace },
  );

  assert.equal(result.path, skillPath);
  assert.equal(result.skill, "$playwright");
  assert.equal(result.description, "Automate a browser from the terminal.");
});

test("Skill resolves project-local .dclaw skills by frontmatter name", async () => {
  const nestedWorkspace = path.join(tempRoot, "dclaw-workspace", "apps", "demo");
  const skillPath = path.join(tempRoot, "dclaw-workspace", ".dclaw", "skills", "docs", "SKILL.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await mkdir(nestedWorkspace, { recursive: true });
  await writeFile(
    skillPath,
    [
      "---",
      'name: "doc-review"',
      "---",
      "description: Review documentation changes with project-specific checks.",
      "# Doc Review",
    ].join("\n"),
    "utf8",
  );

  const result = await skillTool.execute(
    {
      skill: "doc-review",
    },
    { workspaceRoot: nestedWorkspace },
  );

  assert.equal(result.path, skillPath);
  assert.equal(result.description, "Review documentation changes with project-specific checks.");
});

test("Skill resolves legacy commands markdown files from project .codex/commands", async () => {
  const nestedWorkspace = path.join(tempRoot, "legacy-workspace", "pkg");
  const commandPath = path.join(tempRoot, "legacy-workspace", ".codex", "commands", "deploy.md");
  await mkdir(path.dirname(commandPath), { recursive: true });
  await mkdir(nestedWorkspace, { recursive: true });
  await writeFile(
    commandPath,
    [
      "---",
      "name: deploy",
      "---",
      "description: Ship the current branch.",
      "# Deploy",
      "Run release checks first.",
    ].join("\n"),
    "utf8",
  );

  const result = await skillTool.execute(
    {
      skill: "/deploy",
    },
    { workspaceRoot: nestedWorkspace },
  );

  assert.equal(result.path, commandPath);
  assert.equal(result.description, "Ship the current branch.");
  assert.match(result.prompt, /Run release checks first/);
});

test("Skill resolves legacy commands by frontmatter name instead of filename order", async () => {
  const nestedWorkspace = path.join(tempRoot, "frontmatter-workspace", "pkg");
  const commandRoot = path.join(tempRoot, "frontmatter-workspace", ".codex", "commands");
  await mkdir(commandRoot, { recursive: true });
  await mkdir(nestedWorkspace, { recursive: true });

  await writeFile(
    path.join(commandRoot, "zzz-random-name.md"),
    [
      "---",
      'name: "release"',
      "---",
      "description: Run the release workflow.",
      "# Release",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(commandRoot, "alpha-other.md"),
    [
      "---",
      'name: "other"',
      "---",
      "description: Another command.",
      "# Other",
    ].join("\n"),
    "utf8",
  );

  const result = await skillTool.execute(
    {
      skill: "$release",
    },
    { workspaceRoot: nestedWorkspace },
  );

  assert.equal(result.path, path.join(commandRoot, "zzz-random-name.md"));
  assert.equal(result.description, "Run the release workflow.");
});

test("Skill reports unknown skills clearly", async () => {
  await mkdir(tempRoot, { recursive: true });

  await assert.rejects(
    () =>
      skillTool.execute(
        {
          skill: "missing-skill",
        },
        { workspaceRoot: tempRoot },
      ),
    /unknown skill: missing-skill/,
  );
});
