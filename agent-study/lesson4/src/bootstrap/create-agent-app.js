import path from "node:path";

import { loadLocalEnv } from "../config/load-env.js";
import { AgentRuntime } from "../core/agent-runtime.js";
import { Session } from "../core/session.js";
import {
  loadSessionFromFile,
  resolveResumePath,
  saveSessionToFile,
} from "../core/session-store.js";
import { ToolRegistry } from "../core/tool-registry.js";
import { createTraceLogger } from "../logging/trace-logger.js";
import { createModel } from "../model/create-model.js";
import { bashTool } from "../tools/bash.js";
import { finalAnswerTool } from "../tools/final-answer.js";
import { grepTextTool } from "../tools/grep-text.js";
import { listFilesTool } from "../tools/list-files.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";

export function createAgentApp({ workspaceRoot = process.cwd(), resume = null } = {}) {
  loadLocalEnv(workspaceRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const traceLogger = createTraceLogger(resolvedWorkspaceRoot);
  const resumePath = resolveResumePath(resolvedWorkspaceRoot, resume);

  const session = resumePath
    ? Session.fromJSON(loadSessionFromFile(resumePath), resumePath)
    : new Session();
  const toolRegistry = new ToolRegistry();

  toolRegistry.register(listFilesTool);
  toolRegistry.register(readFileTool);
  toolRegistry.register(grepTextTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(bashTool);
  toolRegistry.register(finalAnswerTool);

  const runtime = new AgentRuntime({
    session,
    model: createModel({ traceLogger }),
    toolRegistry,
    traceLogger,
    systemPrompt: [
      "You are a teaching coding agent.",
      "Use tools when needed, then explain what happened clearly.",
      "Prefer search before reading when the task mentions finding code.",
      "When a task needs workspace context, inspect files before answering.",
    ].join("\n"),
  });

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    toolRegistry,
    runtime,
    modelMode: process.env.MODEL_PROVIDER ?? "openai-compatible",
    traceLogPath: traceLogger.logPath,
    summaryLogPath: traceLogger.summaryPath,
    sessionId: session.sessionId,
    sessionPath: session.persistencePath,
    async run(prompt) {
      const result = await runtime.run(prompt, {
        workspaceRoot: resolvedWorkspaceRoot,
      });
      const savedPath = saveSessionToFile(resolvedWorkspaceRoot, session);
      session.persistencePath = savedPath;
      result.sessionPath = savedPath;
      return result;
    },
  };
}
