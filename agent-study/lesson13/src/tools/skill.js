import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

function normalizeRequestedSkill(skill) {
  const requested = String(skill ?? "").trim().replace(/^[$/]+/, "");
  if (!requested) {
    throw new Error("skill must not be empty");
  }
  return requested;
}

async function pathType(targetPath) {
  try {
    const stats = await stat(targetPath);
    if (stats.isDirectory()) {
      return "dir";
    }
    if (stats.isFile()) {
      return "file";
    }
    return null;
  } catch {
    return null;
  }
}

async function isDirectory(targetPath) {
  return (await pathType(targetPath)) === "dir";
}

async function isFile(targetPath) {
  return (await pathType(targetPath)) === "file";
}

function parseSkillFrontmatterValue(contents, key) {
  const lines = String(contents ?? "").split("\n");
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      break;
    }

    if (trimmed.startsWith(`${key}:`)) {
      const value = trimmed
        .slice(`${key}:`.length)
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim();
      if (value) {
        return value;
      }
    }
  }

  return null;
}

function parseSkillName(contents) {
  return parseSkillFrontmatterValue(contents, "name");
}

function parseSkillDescription(contents) {
  for (const line of String(contents ?? "").split("\n")) {
    if (line.startsWith("description:")) {
      const trimmed = line.slice("description:".length).trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
}

async function readSkillContents(skillPath) {
  try {
    return await readFile(skillPath, "utf8");
  } catch {
    return null;
  }
}

async function collectSkillCandidatesInSkillsDir(rootPath) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(rootPath, entry.name, "SKILL.md");
    if (!(await isFile(skillPath))) {
      continue;
    }

    const contents = await readSkillContents(skillPath);
    const parsedName = contents ? parseSkillName(contents) : null;
    candidates.push({
      name: parsedName ?? entry.name,
      path: skillPath,
    });
  }

  candidates.sort((left, right) => left.name.localeCompare(right.name));
  return candidates;
}

async function collectSkillCandidatesInLegacyCommandsDir(rootPath) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    const candidatePath = entry.isDirectory()
      ? path.join(rootPath, entry.name, "SKILL.md")
      : entry.isFile() && entry.name.toLowerCase().endsWith(".md")
        ? path.join(rootPath, entry.name)
        : null;

    if (!candidatePath || !(await isFile(candidatePath))) {
      continue;
    }

    const contents = await readSkillContents(candidatePath);
    const fallbackName = entry.isDirectory()
      ? entry.name
      : path.basename(candidatePath, path.extname(candidatePath));
    const parsedName = contents ? parseSkillName(contents) : null;
    candidates.push({
      name: parsedName ?? fallbackName,
      path: candidatePath,
    });
  }

  candidates.sort((left, right) => left.name.localeCompare(right.name));
  return candidates;
}

async function pushSkillLookupRoot(roots, rootPath, origin) {
  if (!(await isDirectory(rootPath))) {
    return;
  }

  if (roots.some((root) => root.path === rootPath)) {
    return;
  }

  roots.push({ path: rootPath, origin });
}

async function pushPrefixedSkillLookupRoots(roots, prefix) {
  await pushSkillLookupRoot(roots, path.join(prefix, "skills"), "skills_dir");
  await pushSkillLookupRoot(roots, path.join(prefix, "commands"), "legacy_commands_dir");
}

async function pushProjectSkillLookupRoots(roots, workspaceRoot) {
  let current = path.resolve(workspaceRoot);

  while (true) {
    for (const prefixName of [".omc", ".agents", ".claw", ".codex", ".claude", ".dclaw"]) {
      await pushPrefixedSkillLookupRoots(roots, path.join(current, prefixName));
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

async function pushHomeSkillLookupRoots(roots, homePath) {
  for (const prefixName of [".omc", ".claw", ".codex", ".claude", ".dclaw"]) {
    await pushPrefixedSkillLookupRoots(roots, path.join(homePath, prefixName));
  }

  await pushSkillLookupRoot(roots, path.join(homePath, ".agents", "skills"), "skills_dir");
  await pushSkillLookupRoot(roots, path.join(homePath, ".config", "opencode", "skills"), "skills_dir");
  await pushSkillLookupRoot(
    roots,
    path.join(homePath, ".claude", "skills", "omc-learned"),
    "skills_dir",
  );
}

async function skillLookupRoots(workspaceRoot) {
  const roots = [];

  await pushProjectSkillLookupRoots(roots, workspaceRoot);

  if (process.env.CLAW_CONFIG_HOME) {
    await pushPrefixedSkillLookupRoots(roots, process.env.CLAW_CONFIG_HOME);
  }
  if (process.env.CODEX_HOME) {
    await pushPrefixedSkillLookupRoots(roots, process.env.CODEX_HOME);
  }
  if (process.env.DCLAW_HOME) {
    await pushPrefixedSkillLookupRoots(roots, process.env.DCLAW_HOME);
  }
  if (process.env.HOME) {
    await pushHomeSkillLookupRoots(roots, process.env.HOME);
  }
  if (process.env.CLAUDE_CONFIG_DIR) {
    await pushSkillLookupRoot(roots, path.join(process.env.CLAUDE_CONFIG_DIR, "skills"), "skills_dir");
    await pushSkillLookupRoot(
      roots,
      path.join(process.env.CLAUDE_CONFIG_DIR, "skills", "omc-learned"),
      "skills_dir",
    );
    await pushSkillLookupRoot(roots, path.join(process.env.CLAUDE_CONFIG_DIR, "commands"), "legacy_commands_dir");
  }

  for (const compatPath of ["/home/bellman/.claw", "/home/bellman/.codex", "/home/bellman/.dclaw"]) {
    await pushPrefixedSkillLookupRoots(roots, compatPath);
  }

  return roots;
}

async function resolveSkillPathInSkillsDir(rootPath, requested) {
  const candidates = await collectSkillCandidatesInSkillsDir(rootPath);
  return candidates.find((candidate) => candidate.name.toLowerCase() === requested.toLowerCase())?.path ?? null;
}

async function resolveSkillPathInLegacyCommandsDir(rootPath, requested) {
  const candidates = await collectSkillCandidatesInLegacyCommandsDir(rootPath);
  return candidates.find((candidate) => candidate.name.toLowerCase() === requested.toLowerCase())?.path ?? null;
}

async function resolveSkillPath(workspaceRoot, skill) {
  const requested = normalizeRequestedSkill(skill);
  const roots = await skillLookupRoots(workspaceRoot);

  for (const root of roots) {
    const skillPath = root.origin === "skills_dir"
      ? await resolveSkillPathInSkillsDir(root.path, requested)
      : await resolveSkillPathInLegacyCommandsDir(root.path, requested);

    if (skillPath) {
      return skillPath;
    }
  }

  throw new Error(`unknown skill: ${requested}`);
}

export const skillTool = {
  name: "Skill",
  family: "skill",
  description: "Load a local skill prompt from the configured skills or commands directories.",
  inputSchema: {
    type: "object",
    required: ["skill"],
    properties: {
      skill: { type: "string" },
      args: { type: "string" },
    },
  },
  async execute(input, context) {
    const skillPath = await resolveSkillPath(context.workspaceRoot, input.skill);
    const prompt = await readFile(skillPath, "utf8");
    const description = parseSkillDescription(prompt);

    return {
      skill: input.skill,
      path: skillPath,
      args: input.args ?? null,
      description,
      prompt,
    };
  },
};
