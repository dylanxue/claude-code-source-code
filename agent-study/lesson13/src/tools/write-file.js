import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultFileWriteConfig, makeStructuredPatch, resolveWorkspaceFilePath } from "./file-ops.js";

export const writeFileTool = {
  name: "write_file",
  family: "file_write",
  description: "Write a text file in the workspace.",
  inputSchema: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
  },
  async execute(input, context) {
    const config = defaultFileWriteConfig();
    const contentBytes = Buffer.byteLength(input.content, "utf8");
    if (contentBytes > config.maxWriteFileBytes) {
      throw new Error(
        `content is too large (${contentBytes} bytes, max ${config.maxWriteFileBytes} bytes)`,
      );
    }

    const { targetPath, existed } = await resolveWorkspaceFilePath(context.workspaceRoot, input.path, {
      allowMissing: true,
    });
    const originalFile = existed ? await readFile(targetPath, "utf8").catch(() => null) : null;

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.content, "utf8");

    return {
      path: input.path,
      type: existed ? "update" : "create",
      filePath: targetPath,
      content: input.content,
      structuredPatch: makeStructuredPatch(originalFile ?? "", input.content),
      originalFile,
      gitDiff: null,
    };
  },
};
