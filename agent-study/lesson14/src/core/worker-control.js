import path from "node:path";

import { createTraceLogger as defaultCreateTraceLogger } from "../logging/trace-logger.js";
import { createModel as defaultCreateModel } from "../model/create-model.js";
import { createPreparedSubagentExecution, finalizePreparedSubagentExecution } from "./subagent-runner.js";
import { defaultCompactionConfig } from "./session-compaction.js";
import { allowedToolsForSubagent, normalizeSubagentType } from "./subagent-types.js";
import {
  createWorkerId,
  ensureWorkerArtifactPaths,
  loadWorkerManifest,
  saveWorkerManifest,
} from "./worker-store.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function buildWorkerEvent(event, status, detail = null) {
  return {
    event,
    status,
    detail: normalizeLine(detail) || null,
    emittedAt: nowIso(),
  };
}

function formatWorker(worker) {
  return {
    worker_id: worker.workerId,
    session_id: worker.sessionId,
    name: worker.name,
    description: worker.description,
    prompt: worker.prompt,
    subagent_type: worker.subagentType,
    model: worker.model,
    status: worker.status,
    ready: worker.status === "ready_for_prompt",
    created_at: worker.createdAt,
    updated_at: worker.updatedAt,
    completed_at: worker.completedAt,
    agent_id: worker.agentId,
    task_id: worker.taskId,
    allowed_tools: worker.allowedTools,
    prompt_delivery_attempts: worker.promptDeliveryAttempts,
    prompt_in_flight: worker.promptInFlight,
    last_prompt: worker.lastPrompt,
    replay_prompt: worker.replayPrompt,
    result: worker.result,
    terminal_reason: worker.terminalReason,
    last_error: worker.lastError,
    events: worker.events,
    manifest_file: worker.manifestFile,
    state_file: worker.stateFile,
    agent_manifest_file: worker.agentManifestFile,
    output_file: worker.outputFile,
    session_file: worker.sessionFile,
  };
}

function requireWorker(workspaceRoot, workerId, { sessionId = null } = {}) {
  const worker = loadWorkerManifest(workspaceRoot, workerId);
  if (!worker) {
    throw new Error(`worker not found: ${normalizeLine(workerId)}`);
  }

  const normalizedSessionId = normalizeLine(sessionId);
  if (normalizedSessionId && worker.sessionId !== normalizedSessionId) {
    throw new Error(`worker not found: ${normalizeLine(workerId)}`);
  }

  return worker;
}

function persistWorkerTransition(workspaceRoot, workerId, updater) {
  const current = requireWorker(workspaceRoot, workerId);
  const next = updater(current);
  saveWorkerManifest(next);
  return next;
}

function workerTerminalStateFromAgentStatus(agentStatus, agentError) {
  const normalized = normalizeLine(agentStatus).toLowerCase();
  if (normalized === "completed") {
    return { status: "finished", terminalReason: "completed", lastError: null };
  }

  if (normalized === "stopped" || normalized === "cancelled") {
    return { status: "finished", terminalReason: normalized, lastError: agentError ?? null };
  }

  return {
    status: "failed",
    terminalReason: normalized || "failed",
    lastError: normalizeLine(agentError) || "worker execution failed",
  };
}

export function createBackgroundWorkerControl({
  createModel = ({ traceLogger, modelOverride } = {}) =>
    defaultCreateModel({ traceLogger, modelOverride }),
  createTraceLogger = defaultCreateTraceLogger,
  createCompactionConfig = () => defaultCompactionConfig(),
  maxIterations = 16,
  bootDelayMs = 0,
} = {}) {
  async function createWorker(input, context = {}) {
    const workspaceRoot = path.resolve(context.workspaceRoot ?? process.cwd());
    const description = normalizeLine(input.description);
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";

    if (!description) {
      throw new Error("description must not be empty");
    }

    if (!prompt) {
      throw new Error("prompt must not be empty");
    }

    const subagentType = normalizeSubagentType(input.subagent_type);
    const workerId = createWorkerId();
    const createdAt = nowIso();
    const artifacts = ensureWorkerArtifactPaths(workspaceRoot, workerId);
    const worker = {
      workerId,
      sessionId: normalizeLine(context.sessionId) || null,
      name: normalizeLine(input.name) || description,
      description,
      prompt,
      subagentType,
      model: normalizeLine(input.model) || null,
      status: "spawning",
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      agentId: null,
      taskId: null,
      agentManifestFile: null,
      outputFile: null,
      sessionFile: null,
      manifestFile: artifacts.manifestFile,
      stateFile: artifacts.stateFile,
      allowedTools: [...allowedToolsForSubagent(subagentType)],
      promptDeliveryAttempts: 0,
      promptInFlight: false,
      lastPrompt: null,
      replayPrompt: null,
      result: null,
      terminalReason: null,
      lastError: null,
      events: [buildWorkerEvent("worker.spawning", "spawning", "worker created")],
    };

    saveWorkerManifest(worker);

    setTimeout(() => {
      try {
        persistWorkerTransition(workspaceRoot, workerId, (current) => {
          if (current.status !== "spawning") {
            return current;
          }

          return {
            ...current,
            status: "ready_for_prompt",
            updatedAt: nowIso(),
            events: [
              ...current.events,
              buildWorkerEvent("worker.ready", "ready_for_prompt", "worker boot completed"),
            ],
          };
        });
      } catch {
        // Ignore background boot persistence errors for the teaching runtime.
      }
    }, Math.max(0, Number(bootDelayMs) || 0));

    return formatWorker(worker);
  }

  async function getWorker(input, context = {}) {
    const workspaceRoot = path.resolve(context.workspaceRoot ?? process.cwd());
    const worker = requireWorker(workspaceRoot, input.worker_id, {
      sessionId: context.sessionId,
    });
    return formatWorker(worker);
  }

  async function awaitWorkerReady(input, context = {}) {
    const workspaceRoot = path.resolve(context.workspaceRoot ?? process.cwd());
    const timeoutMs = Math.max(0, Number(input.timeout_ms ?? 1000) || 1000);
    const pollIntervalMs = Math.max(10, Number(input.poll_interval_ms ?? 25) || 25);
    const startedAt = Date.now();
    let worker = requireWorker(workspaceRoot, input.worker_id, {
      sessionId: context.sessionId,
    });

    while (
      worker.status === "spawning" &&
      Date.now() - startedAt < timeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      worker = requireWorker(workspaceRoot, input.worker_id, {
        sessionId: context.sessionId,
      });
    }

    return {
      ...formatWorker(worker),
      ready: worker.status === "ready_for_prompt",
      blocked: worker.status === "failed",
      timed_out: worker.status === "spawning",
    };
  }

  async function sendWorkerPrompt(input, context = {}) {
    const workspaceRoot = path.resolve(context.workspaceRoot ?? process.cwd());
    const workerId = normalizeLine(input.worker_id);
    const initialWorker = requireWorker(workspaceRoot, workerId, {
      sessionId: context.sessionId,
    });

    if (initialWorker.status !== "ready_for_prompt") {
      throw new Error(
        `worker ${workerId} is not ready for prompt delivery; current status: ${initialWorker.status}`,
      );
    }

    const nextPrompt =
      (typeof input.prompt === "string" && input.prompt.trim()) ||
      initialWorker.replayPrompt ||
      initialWorker.prompt;
    if (!nextPrompt) {
      throw new Error(`worker ${workerId} has no prompt to send or replay`);
    }

    const execution = createPreparedSubagentExecution({
      input: {
        description: initialWorker.description,
        prompt: nextPrompt,
        subagent_type: initialWorker.subagentType,
        name: initialWorker.name,
        model: initialWorker.model,
      },
      context: {
        ...context,
        workspaceRoot,
      },
      createModel,
      createTraceLogger,
      createCompactionConfig,
      maxIterations,
    });

    const runningWorker = persistWorkerTransition(workspaceRoot, workerId, (current) => ({
      ...current,
      prompt: nextPrompt,
      status: "running",
      updatedAt: nowIso(),
      agentId: execution.agentId,
      taskId: execution.taskId,
      agentManifestFile: execution.artifacts.manifestFile,
      outputFile: execution.artifacts.outputFile,
      sessionFile: execution.artifacts.sessionFile,
      promptDeliveryAttempts: current.promptDeliveryAttempts + 1,
      promptInFlight: true,
      lastPrompt: nextPrompt,
      replayPrompt: null,
      terminalReason: null,
      lastError: null,
      result: null,
      events: [
        ...current.events,
        buildWorkerEvent("worker.running", "running", "prompt dispatched to worker"),
      ],
    }));

    setTimeout(() => {
      void finalizePreparedSubagentExecution(execution)
        .then((agentManifest) => {
          persistWorkerTransition(workspaceRoot, workerId, (current) => {
            const terminal = workerTerminalStateFromAgentStatus(agentManifest.status, agentManifest.error);
            return {
              ...current,
              status: terminal.status,
              updatedAt: nowIso(),
              completedAt: agentManifest.completedAt ?? nowIso(),
              promptInFlight: false,
              result: typeof agentManifest.result === "string" ? agentManifest.result : null,
              terminalReason: terminal.terminalReason,
              lastError: terminal.lastError,
              events: [
                ...current.events,
                buildWorkerEvent(
                  terminal.status === "finished" ? "worker.finished" : "worker.failed",
                  terminal.status,
                  terminal.status === "finished"
                    ? `worker completed with ${terminal.terminalReason}`
                    : terminal.lastError,
                ),
              ],
            };
          });
        })
        .catch(() => {
          // Ignore background lifecycle persistence failures in the teaching runtime.
        });
    }, 0);

    return formatWorker(runningWorker);
  }

  return {
    createWorker,
    getWorker,
    awaitWorkerReady,
    sendWorkerPrompt,
  };
}
