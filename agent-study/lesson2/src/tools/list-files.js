import { readdir } from "node:fs/promises";
import path from "node:path";

export const listFilesTool = {
  name: "list_files",
  description: "List files under a directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
  },
  async execute(input, context) {
    const targetPath = path.resolve(context.workspaceRoot, input.path ?? ".");
    const entries = await readdir(targetPath, { withFileTypes: true });

    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }));
  },
};
