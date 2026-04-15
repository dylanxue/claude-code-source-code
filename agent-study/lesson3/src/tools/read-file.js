import { readFile } from "node:fs/promises";
import path from "node:path";

export const readFileTool = {
  name: "read_file",
  description: "Read a UTF-8 text file from the workspace.",
  inputSchema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
    },
  },
  async execute(input, context) {
    const targetPath = path.resolve(context.workspaceRoot, input.path);
    const content = await readFile(targetPath, "utf8");

    return {
      path: input.path,
      preview: content.slice(0, 4000),
    };
  },
};
