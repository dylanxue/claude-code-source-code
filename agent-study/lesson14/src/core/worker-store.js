import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveWorkspaceScopedDclawChildPath } from "../config/dclaw-paths.js";

function nowIso() {
  return new Date().toISOString();
}

function timestampId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const name = normalizeLine(event.event);
  const status = normalizeLine(event.status).toLowerCase();
  if (!name || !status) {
    return null;
  }

  return {
    event: name,
    status,
    detail: normalizeLine(event.detail) || null,
    emittedAt: normalizeLine(event.emittedAt) || nowIso(),
  };
}

function normalizeEvents(events) {
  return (events ?? []).map(normalizeEvent).filter(Boolean);
}

function normalizeWorkerStatus(status) {
  const normalized = normalizeLine(status).toLowerCase();
  if (["spawning", "ready_for_prompt", "running", "finished", "failed"].includes(normalized)) {
    return normalized;
  }

  return "spawning";
}

export function createWorkerId() {
  return `worker-${timestampId()}`;
}

export function ensureWorkerArtifactPaths(workspaceRoot, workerId) {
  const workerDir = resolveWorkspaceScopedDclawChildPath(workspaceRoot, "workers", workerId);
  mkdirSync(workerDir, { recursive: true });

  return {
    workerDir,
    manifestFile: path.join(workerDir, "manifest.json"),
    stateFile: path.join(workerDir, "worker-state.json"),
  };
}

export function normalizeWorkerManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return null;
  }

  const workerId = normalizeLine(manifest.workerId);
  const manifestFile = normalizeLine(manifest.manifestFile);
  const stateFile = normalizeLine(manifest.stateFile);
  const description = normalizeLine(manifest.description);
  const subagentType = normalizeLine(manifest.subagentType);

  if (!workerId || !manifestFile || !stateFile || !description || !subagentType) {
    return null;
  }

  return {
    workerId,
    sessionId: normalizeLine(manifest.sessionId) || null,
    name: normalizeLine(manifest.name) || "worker-task",
    description,
    prompt: typeof manifest.prompt === "string" ? manifest.prompt : "",
    subagentType,
    model: normalizeLine(manifest.model) || null,
    status: normalizeWorkerStatus(manifest.status),
    ready: normalizeWorkerStatus(manifest.status) === "ready_for_prompt",
    createdAt: normalizeLine(manifest.createdAt) || nowIso(),
    updatedAt: normalizeLine(manifest.updatedAt) || nowIso(),
    completedAt: normalizeLine(manifest.completedAt) || null,
    agentId: normalizeLine(manifest.agentId) || null,
    taskId: normalizeLine(manifest.taskId) || null,
    agentManifestFile: normalizeLine(manifest.agentManifestFile) || null,
    outputFile: normalizeLine(manifest.outputFile) || null,
    sessionFile: normalizeLine(manifest.sessionFile) || null,
    manifestFile,
    stateFile,
    allowedTools: Array.isArray(manifest.allowedTools)
      ? manifest.allowedTools.map((toolName) => normalizeLine(toolName)).filter(Boolean)
      : [],
    promptDeliveryAttempts: Math.max(0, Number(manifest.promptDeliveryAttempts ?? 0) || 0),
    promptInFlight: Boolean(manifest.promptInFlight),
    lastPrompt: typeof manifest.lastPrompt === "string" ? manifest.lastPrompt : null,
    replayPrompt: typeof manifest.replayPrompt === "string" ? manifest.replayPrompt : null,
    result: typeof manifest.result === "string" ? manifest.result : null,
    terminalReason: normalizeLine(manifest.terminalReason) || null,
    lastError: normalizeLine(manifest.lastError) || null,
    events: normalizeEvents(manifest.events),
  };
}

export function saveWorkerManifest(manifest) {
  const normalized = normalizeWorkerManifest(manifest);
  if (!normalized) {
    throw new Error("worker manifest is missing required fields");
  }

  mkdirSync(path.dirname(normalized.manifestFile), { recursive: true });
  writeFileSync(normalized.manifestFile, JSON.stringify(normalized, null, 2), "utf8");
  saveWorkerStateSnapshot(normalized);
  return normalized.manifestFile;
}

export function loadWorkerManifest(workspaceRoot, workerId) {
  const artifacts = ensureWorkerArtifactPaths(workspaceRoot, workerId);
  if (!existsSync(artifacts.manifestFile)) {
    return null;
  }

  try {
    return normalizeWorkerManifest(JSON.parse(readFileSync(artifacts.manifestFile, "utf8")));
  } catch {
    return null;
  }
}

export function saveWorkerStateSnapshot(manifest) {
  const normalized = normalizeWorkerManifest(manifest);
  if (!normalized) {
    throw new Error("worker manifest is missing required fields");
  }

  const snapshot = {
    worker_id: normalized.workerId,
    session_id: normalized.sessionId,
    status: normalized.status,
    is_ready: normalized.status === "ready_for_prompt",
    prompt_in_flight: normalized.promptInFlight,
    prompt_delivery_attempts: normalized.promptDeliveryAttempts,
    last_event: normalized.events.at(-1) ?? null,
    updated_at: normalized.updatedAt,
    completed_at: normalized.completedAt,
    agent_id: normalized.agentId,
    task_id: normalized.taskId,
    terminal_reason: normalized.terminalReason,
    last_error: normalized.lastError,
  };

  mkdirSync(path.dirname(normalized.stateFile), { recursive: true });
  writeFileSync(normalized.stateFile, JSON.stringify(snapshot, null, 2), "utf8");
  return normalized.stateFile;
}
