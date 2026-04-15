import { readdir } from "node:fs/promises";
import path from "node:path";

import { createContinuation } from "./tool-continuation.js";

function defaultListFilesConfig() {
  return {
    maxEntries: Number(process.env.LIST_FILES_MAX_ENTRIES ?? 200),
  };
}

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
    const config = defaultListFilesConfig();
    const targetPath = path.resolve(context.workspaceRoot, input.path ?? ".");
    const entries = await readdir(targetPath, { withFileTypes: true });
    const normalizedEntries = entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const returnedEntries = normalizedEntries.slice(0, config.maxEntries);

    return {
      path: input.path ?? ".",
      totalEntryCount: normalizedEntries.length,
      returnedEntryCount: returnedEntries.length,
      omittedEntryCount: Math.max(0, normalizedEntries.length - returnedEntries.length),
      truncated: returnedEntries.length < normalizedEntries.length,
      entries: returnedEntries,
      continuation:
        returnedEntries.length < normalizedEntries.length
          ? createContinuation({
              reason: "entry_list_truncated",
              summary: "Only part of the directory listing was returned because it exceeded the entry budget.",
              strategy: "narrow_path",
              suggestedTool: "list_files",
              suggestedActions: [
                "List a narrower subdirectory instead of the current path.",
                "Use grep_text if you are looking for files related to a specific term.",
              ],
            })
          : null,
    };
  },
};
