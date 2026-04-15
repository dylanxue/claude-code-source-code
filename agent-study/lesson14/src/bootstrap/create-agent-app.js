import path from "node:path";

import { resolveDclawRoot } from "../config/dclaw-paths.js";
import { loadLocalEnv } from "../config/load-env.js";
import { createBackgroundSubagentRunner } from "../core/subagent-runner.js";
import { createBackgroundWorkerControl } from "../core/worker-control.js";
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
import { registerDefaultTools } from "./register-default-tools.js";
import { buildAppSystemPrompt } from "./system-prompt.js";

export function createAgentApp({ workspaceRoot = process.cwd(), resume = null, runtimeCallbacks = {} } = {}) {
  loadLocalEnv(workspaceRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const dclawRoot = resolveDclawRoot(resolvedWorkspaceRoot);
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

  const runSubagent = createBackgroundSubagentRunner({
    createModel: ({ traceLogger: childTraceLogger, modelOverride } = {}) =>
      createModel({ traceLogger: childTraceLogger, modelOverride }),
  });
  const workerControl = createBackgroundWorkerControl({
    createModel: ({ traceLogger: childTraceLogger, modelOverride, subagentType } = {}) =>
      createModel({ traceLogger: childTraceLogger, modelOverride, subagentType }),
  });
  registerDefaultTools(toolRegistry, { runSubagent, workerControl });

  const runtime = new AgentRuntime({
    session,
    model: createModel({ traceLogger }),
    toolRegistry,
    workspaceRoot: resolvedWorkspaceRoot,
    traceLogger,
    compactionConfig,
    onSessionUpdated: persistSession,
    onRuntimeEvent: runtimeCallbacks.onRuntimeEvent ?? null,
    systemPrompt: buildAppSystemPrompt({
      workspaceRoot: resolvedWorkspaceRoot,
      resumePath,
    }),
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
    dclawRoot,
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
        sessionId: session.sessionId,
        dclawRoot,
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
