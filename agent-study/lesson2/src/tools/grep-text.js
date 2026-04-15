import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function walkFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

export const grepTextTool = {
  name: "grep_text",
  description: "Search for a text pattern under a directory.",
  inputSchema: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
    },
  },
  async execute(input, context) {
    const searchRoot = path.resolve(context.workspaceRoot, input.path ?? ".");
    const files = await walkFiles(searchRoot);
    const matches = [];

    for (const filePath of files) {
      const content = await readFile(filePath, "utf8").catch(() => null);

      if (!content) {
        continue;
      }

      const lines = content.split("\n");

      lines.forEach((line, index) => {
        if (line.includes(input.pattern)) {
          matches.push({
            path: path.relative(context.workspaceRoot, filePath),
            line: index + 1,
            preview: line.trim(),
          });
        }
      });
    }

    return {
      pattern: input.pattern,
      path: input.path ?? ".",
      matches,
    };
  },
};
