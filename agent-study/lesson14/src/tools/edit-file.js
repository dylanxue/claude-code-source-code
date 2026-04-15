import { readFile, stat, writeFile } from "node:fs/promises";

import {
  defaultFileWriteConfig,
  isBinaryBuffer,
  makeStructuredPatch,
  resolveWorkspaceFilePath,
} from "./file-ops.js";

export const editFileTool = {
  name: "edit_file",
  family: "file_edit",
  description: "Replace text in a workspace file.",
  inputSchema: {
    type: "object",
    required: ["path", "old_string", "new_string"],
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
  },
  async execute(input, context) {
    const config = defaultFileWriteConfig();
    const { candidatePath, targetPath } = await resolveWorkspaceFilePath(
      context.workspaceRoot,
      input.path,
    );
    const fileStat = await stat(candidatePath);
    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${input.path}`);
    }

    if (fileStat.size > config.maxWriteFileBytes) {
      throw new Error(
        `file exceeds maximum editable size of ${config.maxWriteFileBytes} bytes`,
      );
    }

    if (input.old_string.length === 0) {
      throw new Error("old_string must not be empty");
    }

    if (input.old_string === input.new_string) {
      throw new Error("old_string and new_string must differ");
    }

    const originalBuffer = await readFile(targetPath);
    if (isBinaryBuffer(originalBuffer, config.binaryProbeBytes)) {
      throw new Error("file appears to be binary");
    }

    const originalFile = originalBuffer.toString("utf8");
    if (!originalFile.includes(input.old_string)) {
      throw new Error("old_string not found in file");
    }

    const replaceAll = input.replace_all === true;
    const updatedFile = replaceAll
      ? originalFile.split(input.old_string).join(input.new_string)
      : originalFile.replace(input.old_string, input.new_string);

    await writeFile(targetPath, updatedFile, "utf8");

    return {
      path: input.path,
      filePath: targetPath,
      oldString: input.old_string,
      newString: input.new_string,
      originalFile,
      structuredPatch: makeStructuredPatch(originalFile, updatedFile),
      userModified: false,
      replaceAll,
      gitDiff: null,
    };
  },
};
