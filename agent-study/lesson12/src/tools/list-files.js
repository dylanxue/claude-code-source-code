import { readdir } from "node:fs/promises";

import { resolveWorkspaceFilePath } from "./file-ops.js";

function defaultListFilesConfig() {
  return {
    maxEntries: Number(process.env.LIST_FILES_MAX_ENTRIES ?? 200),
  };
}

export const listFilesTool = {
  name: "list_files",
  family: "file_discovery",
  description: "List files under a directory in the workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
  },
  async execute(input, context) {
    const config = defaultListFilesConfig();
    const requestedPath = input.path ?? ".";
    const { targetPath } = await resolveWorkspaceFilePath(context.workspaceRoot, requestedPath);
    const entries = await readdir(targetPath, { withFileTypes: true });
    const normalizedEntries = entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const returnedEntries = normalizedEntries.slice(0, config.maxEntries);

    return {
      path: requestedPath,
      totalEntryCount: normalizedEntries.length,
      returnedEntryCount: returnedEntries.length,
      omittedEntryCount: Math.max(0, normalizedEntries.length - returnedEntries.length),
      truncated: returnedEntries.length < normalizedEntries.length,
      entries: returnedEntries,
    };
  },
};
