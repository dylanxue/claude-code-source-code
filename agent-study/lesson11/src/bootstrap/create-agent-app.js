import path from "node:path";

import { loadLocalEnv } from "../config/load-env.js";
import { AgentRuntime } from "../core/agent-runtime.js";
import { defaultCompactionConfig } from "../core/session-compaction.js";
import { Session } from "../core/session.js";
import {
  loadSessionFromFile,
  resolveResumePath,
  saveSessionToFile,
  sessionFilePath,
} from "../core/session-store.js";
import { ToolRegistry } from "../core/tool-registry.js";
import { createTraceLogger } from "../logging/trace-logger.js";
import { createModel } from "../model/create-model.js";
import { bashTool } from "../tools/bash.js";
import { editFileTool } from "../tools/edit-file.js";
import { globSearchTool } from "../tools/glob-search.js";
import { grepSearchTool, grepTextTool } from "../tools/grep-text.js";
import { listFilesTool } from "../tools/list-files.js";
import { readFileTool } from "../tools/read-file.js";
import { webFetchTool } from "../tools/web-fetch.js";
import { webSearchTool } from "../tools/web-search.js";
import { writeFileTool } from "../tools/write-file.js";

export function createAgentApp({ workspaceRoot = process.cwd(), resume = null, runtimeCallbacks = {} } = {}) {
  loadLocalEnv(workspaceRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const traceLogger = createTraceLogger(resolvedWorkspaceRoot);
  const resumePath = resolveResumePath(resolvedWorkspaceRoot, resume);
  const compactionConfig = defaultCompactionConfig();

  const session = resumePath
    ? Session.fromJSON(loadSessionFromFile(resumePath), resumePath)
    : new Session();
  session.persistencePath = session.persistencePath ?? sessionFilePath(resolvedWorkspaceRoot, session.sessionId);
  const toolRegistry = new ToolRegistry();

  function persistSession(currentSession) {
    const savedPath = saveSessionToFile(resolvedWorkspaceRoot, currentSession);
    currentSession.persistencePath = savedPath;
    return savedPath;
  }

  persistSession(session);

  toolRegistry.register(listFilesTool);
  toolRegistry.register(globSearchTool);
  toolRegistry.register(readFileTool);
  toolRegistry.register(grepSearchTool);
  toolRegistry.register(grepTextTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(editFileTool);
  toolRegistry.register(bashTool);
  toolRegistry.register(webFetchTool);
  toolRegistry.register(webSearchTool);

  const systemPromptLines = [
    "You are a teaching coding agent.",
    "Use tools when needed, then explain what happened clearly.",
    "Prefer search before reading when the task mentions finding code.",
    "When a task needs workspace context, inspect files before answering.",
    "When a task needs current or external information beyond the workspace, prefer WebSearch or WebFetch over using shell commands as a workaround.",
    "When a tool result includes guard, truncated, limit, omitted, or file_too_large metadata, treat that metadata as evidence about what happened and use it to choose a narrower next step.",
    "Prefer narrowing the scope, path, query, or file region over retrying the same broad request with another tool.",
    "Do not try to bypass large-file or large-output guards by dumping the same file through a different broad command unless the user explicitly asks for that workaround.",
  ];

  if (resumePath) {
    systemPromptLines.push(
      "You are resuming an existing session in the current workspace.",
      "Treat the saved session history as the primary source of truth about what was happening before this turn.",
      "When the user asks to continue or resume, continue the existing task directly instead of re-explaining the README, re-discovering the project from scratch, or treating example commands in docs as the user's current task.",
      "Prefer the current session, current workspace, current logs, and recent tool results over broad re-exploration.",
    );
  }

  const runtime = new AgentRuntime({
    session,
    model: createModel({ traceLogger }),
    toolRegistry,
    workspaceRoot: resolvedWorkspaceRoot,
    traceLogger,
    compactionConfig,
    onSessionUpdated: persistSession,
    onRuntimeEvent: runtimeCallbacks.onRuntimeEvent ?? null,
    systemPrompt: systemPromptLines.join("\n"),
  });

  function buildAnalysisHint() {
    const analysisHintLines = [];
    if (resumePath) {
      analysisHintLines.push(
        "You are continuing an already-started session in the current workspace.",
        "Treat the saved session history, recent tool results, and current workspace state as the primary source of truth.",
        "Resume the task directly. Do not restart the investigation from scratch unless the saved session is clearly insufficient.",
        "Do not treat example commands in README/docs as the user's task unless the user explicitly asks you to execute those examples.",
        "If you need evidence about the current run or resumed session, prefer the current run summary log, current CLI log, current trace log, and current session file before re-reading README or broad project docs.",
        "Current runtime context:",
        `- Run ID: ${traceLogger.runId}`,
        `- Run summary log: ${traceLogger.summaryPath}`,
        `- CLI log: ${traceLogger.cliLogPath}`,
        `- Trace log: ${traceLogger.logPath}`,
        `- Resumed session file: ${session.persistencePath}`,
        `- Existing message count before this turn: ${session.messages.length}`,
        `- Existing compaction count before this turn: ${session.compaction?.count ?? 0}`,
      );
    }
    return analysisHintLines.join("\n");
  }

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    toolRegistry,
    runtime,
    runId: traceLogger.runId,
    modelMode: process.env.MODEL_PROVIDER ?? "openai-compatible",
    traceLogPath: traceLogger.logPath,
    summaryLogPath: traceLogger.summaryPath,
    cliLogPath: traceLogger.cliLogPath,
    writeCliLog: traceLogger.writeCli.bind(traceLogger),
    sessionId: session.sessionId,
    sessionPath: session.persistencePath,
    resumePath,
    isResumed: Boolean(resumePath),
    currentRunLogPaths: {
      runId: traceLogger.runId,
      traceLogPath: traceLogger.logPath,
      summaryLogPath: traceLogger.summaryPath,
      cliLogPath: traceLogger.cliLogPath,
    },
    compactionConfig,
    sessionUsage: session.usage,
    async previewRequestBudget(prompt) {
      return runtime.previewRequestBudget({
        prompt,
        analysisHint: buildAnalysisHint(),
      });
    },
    async run(prompt) {
      const result = await runtime.run(prompt, {
        workspaceRoot: resolvedWorkspaceRoot,
        resumePath,
        isResumed: Boolean(resumePath),
        existingMessageCount: session.messages.length,
        existingCompactionCount: session.compaction?.count ?? 0,
        analysisHint: buildAnalysisHint(),
      });
      const savedPath = persistSession(session);
      result.sessionPath = savedPath;
      return result;
    },
  };
}
