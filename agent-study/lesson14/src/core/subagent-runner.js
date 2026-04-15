import path from "node:path";

import { registerDefaultTools } from "../bootstrap/register-default-tools.js";
import { createTraceLogger as defaultCreateTraceLogger } from "../logging/trace-logger.js";
import { createModel as defaultCreateModel } from "../model/create-model.js";
import { AgentRuntime } from "./agent-runtime.js";
import {
  createAgentId,
  ensureAgentArtifactPaths,
  normalizeAgentName,
  saveAgentManifest,
  saveAgentOutput,
  saveAgentSession,
} from "./agent-store.js";
import {
  allowedToolsForSubagent,
  buildSubagentSystemPrompt,
  normalizeSubagentType,
} from "./subagent-types.js";
import {
  createRegisteredTask,
  createTaskId,
  getRegisteredTask,
  updateRegisteredTask,
} from "./task-registry.js";
import { defaultCompactionConfig } from "./session-compaction.js";
import { Session } from "./session.js";
import {
  classifyLaneBlocker,
  deriveAgentState,
  laneEventBlocked,
  laneEventClosed,
  laneEventFailed,
  laneEventFinished,
  laneEventStarted,
} from "./lane-events.js";
import { ToolRegistry } from "./tool-registry.js";

function nowIso() {
  return new Date().toISOString();
}

function buildSubagentAnalysisHint({ description, subagentType, agentId }) {
  return [
    "You are continuing a delegated subagent task.",
    `- Agent ID: ${agentId}`,
    `- Subagent type: ${subagentType}`,
    `- Delegated description: ${description}`,
    "Stay within this delegated scope and return only the most useful result for the main agent.",
  ].join("\n");
}

function latestToolPayload(session, toolName) {
  return [...session.messages]
    .reverse()
    .find((message) => message.role === "tool" && message.content?.toolName === toolName && message.content?.ok)
    ?.content?.content ?? null;
}

class TaskStoppedError extends Error {
  constructor(taskId) {
    super(`task stopped: ${taskId}`);
    this.name = "TaskStoppedError";
    this.taskId = taskId;
  }
}

function isTaskStopRequested(workspaceRoot, taskId) {
  const task = getRegisteredTask(workspaceRoot, taskId);
  return ["stopped", "cancelled"].includes(String(task?.status ?? "").toLowerCase());
}

function isTaskStoppedError(error) {
  return error instanceof TaskStoppedError;
}

function buildDelegatedTaskPacket(input, subagentType) {
  return {
    objective: input.description,
    scope: `Only complete this delegated ${subagentType} task.`,
    acceptance: ["Return the most useful concise result for the main agent."],
    outOfScope: ["Do not expand into unrelated work unless the delegated prompt explicitly requires it."],
  };
}

export function createPreparedSubagentExecution({
  input,
  context,
  createModel,
  createTraceLogger,
  createCompactionConfig,
  maxIterations,
}) {
  const workspaceRoot = path.resolve(context.workspaceRoot ?? process.cwd());
  const subagentType = normalizeSubagentType(input.subagent_type);
  const agentId = createAgentId();
  const createdAt = nowIso();
  const startedAt = nowIso();
  const name = normalizeAgentName(input.name ?? input.description, input.description);
  const allowedTools = [...allowedToolsForSubagent(subagentType)];
  const taskId = createTaskId();
  const artifacts = ensureAgentArtifactPaths(workspaceRoot, agentId);
  const traceLogger = createTraceLogger(workspaceRoot);
  const session = new Session();
  session.persistencePath = artifacts.sessionFile;
  const delegatedTaskPacket = buildDelegatedTaskPacket(input, subagentType);
  session.setTaskPacket(delegatedTaskPacket);

  const manifest = {
    agentId,
    taskId,
    name,
    description: input.description,
    subagentType,
    model: input.model ?? null,
    status: "running",
    outputFile: artifacts.outputFile,
    manifestFile: artifacts.manifestFile,
    sessionFile: artifacts.sessionFile,
    createdAt,
    startedAt,
    completedAt: null,
    allowedTools,
    prompt: input.prompt,
    result: null,
    laneEvents: [laneEventStarted(startedAt)],
    currentBlocker: null,
    derivedState: deriveAgentState("running"),
    error: null,
    traceLogPath: traceLogger.logPath,
    summaryLogPath: traceLogger.summaryPath,
    cliLogPath: traceLogger.cliLogPath,
    sessionId: session.sessionId,
  };

  saveAgentManifest(manifest);
  saveAgentOutput(artifacts.outputFile, "");
  saveAgentSession(artifacts.sessionFile, session);
  createRegisteredTask(workspaceRoot, {
    taskId,
    prompt: input.prompt,
    description: input.description,
    sessionId: context.sessionId ?? null,
    taskPacket: delegatedTaskPacket,
    status: "running",
    createdAt,
    updatedAt: startedAt,
    messages: session.snapshot(),
    output: "",
    agentId,
    subagentType,
    manifestFile: artifacts.manifestFile,
    outputFile: artifacts.outputFile,
    sessionFile: artifacts.sessionFile,
    error: null,
  });

  const toolRegistry = registerDefaultTools(new ToolRegistry(), {
    allowedToolNames: new Set(allowedTools),
  });

  const runtime = new AgentRuntime({
    session,
    model: createModel({
      traceLogger,
      modelOverride: input.model ?? null,
      subagentType,
    }),
    toolRegistry,
    systemPrompt: buildSubagentSystemPrompt(subagentType),
    workspaceRoot,
    maxIterations,
    traceLogger,
    compactionConfig: createCompactionConfig(),
    onSessionUpdated(currentSession) {
      if (isTaskStopRequested(workspaceRoot, taskId)) {
        throw new TaskStoppedError(taskId);
      }

      saveAgentSession(artifacts.sessionFile, currentSession);
      updateRegisteredTask(workspaceRoot, taskId, {
        status: "running",
        updatedAt: nowIso(),
        messages: currentSession.snapshot(),
      });
    },
  });

  return {
    workspaceRoot,
    subagentType,
    agentId,
    taskId,
    artifacts,
    traceLogger,
    session,
    delegatedTaskPacket,
    manifest,
    runtime,
    input,
  };
}

export async function finalizePreparedSubagentExecution(execution) {
  const {
    workspaceRoot,
    taskId,
    agentId,
    subagentType,
    artifacts,
    session,
    delegatedTaskPacket,
    manifest,
    runtime,
    input,
  } = execution;

  try {
    const result = await runtime.run(input.prompt, {
      workspaceRoot,
      sessionId: session.sessionId,
      analysisHint: buildSubagentAnalysisHint({
        description: input.description,
        subagentType,
        agentId,
      }),
      taskPacket: delegatedTaskPacket,
    });

    if (isTaskStopRequested(workspaceRoot, taskId)) {
      throw new TaskStoppedError(taskId);
    }

    const completedAt = nowIso();
    const output = String(result.output ?? "");
    const structuredResult = latestToolPayload(session, "StructuredOutput")?.structured_output ?? null;
    const latestTodoState = latestToolPayload(session, "TodoWrite") ?? null;
    saveAgentOutput(artifacts.outputFile, output);
    saveAgentSession(artifacts.sessionFile, session);
    const completedManifest = {
      ...manifest,
      status: "completed",
      completedAt,
      result: output,
      laneEvents: [...manifest.laneEvents, laneEventFinished(completedAt, output)],
      currentBlocker: null,
      derivedState: deriveAgentState("completed", output, null, null),
      structuredResult,
      latestTodoState,
    };
    saveAgentManifest(completedManifest);
    updateRegisteredTask(workspaceRoot, taskId, {
      status: "completed",
      updatedAt: completedAt,
      messages: session.snapshot(),
      output,
      error: null,
    });
    return completedManifest;
  } catch (error) {
    const completedAt = nowIso();

    if (isTaskStoppedError(error)) {
      saveAgentSession(artifacts.sessionFile, session);
      const stoppedManifest = {
        ...manifest,
        status: "stopped",
        completedAt,
        laneEvents: [...manifest.laneEvents, laneEventClosed(completedAt, "Task stopped")],
        currentBlocker: null,
        derivedState: deriveAgentState("stopped", null, null, null),
        error: null,
      };
      saveAgentManifest(stoppedManifest);
      updateRegisteredTask(workspaceRoot, taskId, {
        status: "stopped",
        updatedAt: completedAt,
        messages: session.snapshot(),
        output: "",
        error: null,
      });
      return stoppedManifest;
    }

    const message = error instanceof Error ? error.message : String(error);
    const blocker = classifyLaneBlocker(message);
    saveAgentOutput(
      artifacts.outputFile,
      [`Subagent execution failed.`, "", message].join("\n"),
    );
    saveAgentSession(artifacts.sessionFile, session);
    const failedManifest = {
      ...manifest,
      status: "failed",
      completedAt,
      laneEvents: blocker
        ? [...manifest.laneEvents, laneEventBlocked(completedAt, blocker), laneEventFailed(completedAt, blocker)]
        : manifest.laneEvents,
      currentBlocker: blocker,
      derivedState: deriveAgentState("failed", null, message, blocker),
      error: message,
    };
    saveAgentManifest(failedManifest);
    updateRegisteredTask(workspaceRoot, taskId, {
      status: "failed",
      updatedAt: completedAt,
      messages: session.snapshot(),
      output: "",
      error: message,
    });
    return failedManifest;
  }
}

export function createSubagentRunner({
  createModel = ({ traceLogger, modelOverride } = {}) =>
    defaultCreateModel({ traceLogger, modelOverride }),
  createTraceLogger = defaultCreateTraceLogger,
  createCompactionConfig = () => defaultCompactionConfig(),
  maxIterations = 16,
} = {}) {
  return async function runSubagent(input, context = {}) {
    const execution = createPreparedSubagentExecution({
      input,
      context,
      createModel,
      createTraceLogger,
      createCompactionConfig,
      maxIterations,
    });
    return finalizePreparedSubagentExecution(execution);
  };
}

export function createBackgroundSubagentRunner({
  createModel = ({ traceLogger, modelOverride } = {}) =>
    defaultCreateModel({ traceLogger, modelOverride }),
  createTraceLogger = defaultCreateTraceLogger,
  createCompactionConfig = () => defaultCompactionConfig(),
  maxIterations = 16,
} = {}) {
  return async function runSubagent(input, context = {}) {
    const execution = createPreparedSubagentExecution({
      input,
      context,
      createModel,
      createTraceLogger,
      createCompactionConfig,
      maxIterations,
    });

    setTimeout(() => {
      void finalizePreparedSubagentExecution(execution);
    }, 0);

    return execution.manifest;
  };
}
