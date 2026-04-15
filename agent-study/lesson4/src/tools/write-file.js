import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const writeFileTool = {
  name: "write_file",
  description: "Write a UTF-8 text file into the workspace.",
  inputSchema: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
  },
  async execute(input, context) {
    const targetPath = path.resolve(context.workspaceRoot, input.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.content, "utf8");

    return {
      path: input.path,
      written: true,
      bytes: Buffer.byteLength(input.content, "utf8"),
    };
  },
};
