import path from "node:path";

import { AgentRuntime } from "../core/agent-runtime.js";
import { Session } from "../core/session.js";
import { ToolRegistry } from "../core/tool-registry.js";
import { MockModel } from "../model/mock-model.js";
import { bashTool } from "../tools/bash.js";
import { finalAnswerTool } from "../tools/final-answer.js";
import { grepTextTool } from "../tools/grep-text.js";
import { listFilesTool } from "../tools/list-files.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";

export function createAgentApp({ workspaceRoot = process.cwd() } = {}) {
  const session = new Session();
  const toolRegistry = new ToolRegistry();

  toolRegistry.register(listFilesTool);
  toolRegistry.register(readFileTool);
  toolRegistry.register(grepTextTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(bashTool);
  toolRegistry.register(finalAnswerTool);

  const runtime = new AgentRuntime({
    session,
    model: new MockModel(),
    toolRegistry,
    systemPrompt: [
      "You are a teaching coding agent.",
      "Use tools when needed, then explain what happened clearly.",
      "Prefer search before reading when the task mentions finding code.",
    ].join("\n"),
  });

  return {
    workspaceRoot: path.resolve(workspaceRoot),
    toolRegistry,
    runtime,
    async run(prompt) {
      return runtime.run(prompt, {
        workspaceRoot: path.resolve(workspaceRoot),
      });
    },
  };
}
