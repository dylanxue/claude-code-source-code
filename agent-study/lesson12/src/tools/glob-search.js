import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspaceFilePath } from "./file-ops.js";

function globSearchConfig() {
  return {
    maxFiles: Number(process.env.GLOB_SEARCH_MAX_FILES ?? 100),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(globPattern) {
  const pattern = String(globPattern ?? "").split(path.sep).join("/");
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const nextChar = pattern[index + 1];

    if (char === "*" && nextChar === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`);
}

async function walkFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export const globSearchTool = {
  name: "glob_search",
  family: "file_discovery",
  description: "Find files by glob pattern.",
  inputSchema: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
    },
  },
  async execute(input, context) {
    const startedAt = Date.now();
    const config = globSearchConfig();
    const basePath = input.path ?? ".";
    const { targetPath } = await resolveWorkspaceFilePath(context.workspaceRoot, basePath);
    const matcher = globToRegExp(
      path.isAbsolute(input.pattern) ? input.pattern : path.join(targetPath, input.pattern),
    );
    const baseStat = await stat(targetPath);
    const candidateFiles =
      baseStat.isFile() ? [targetPath] : baseStat.isDirectory() ? await walkFiles(targetPath) : [];

    const matches = [];
    for (const filePath of candidateFiles) {
      const normalizedAbsolute = filePath.split(path.sep).join("/");
      if (!matcher.test(normalizedAbsolute)) {
        continue;
      }

      const metadata = await stat(filePath).catch(() => null);
      matches.push({
        filePath,
        modifiedMs: metadata?.mtimeMs ?? 0,
      });
    }

    matches.sort((left, right) => right.modifiedMs - left.modifiedMs);
    const filenames = matches.slice(0, config.maxFiles).map(({ filePath }) => filePath);

    return {
      durationMs: Date.now() - startedAt,
      numFiles: filenames.length,
      filenames,
      truncated: matches.length > config.maxFiles,
    };
  },
};
