import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

import { resolveWorkspaceScopedDclawChildPath } from "../config/dclaw-paths.js";
import { normalizeTaskPacket, validateStructuredTaskPacket } from "./task-packet.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function timestampId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createTaskId() {
  return `task-${timestampId()}`;
}

function normalizeTaskMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const role = normalizeLine(message.role);
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content ?? {});
  const createdAt = normalizeLine(message.createdAt) || nowIso();

  if (!role || !content) {
    return null;
  }

  return {
    role,
    content,
    createdAt,
  };
}

function normalizeTaskMessages(messages) {
  return (messages ?? []).map(normalizeTaskMessage).filter(Boolean);
}

function normalizeTaskStatus(status) {
  const normalized = normalizeLine(status).toLowerCase();
  if (!normalized) {
    return "created";
  }

  if (["created", "running", "completed", "failed", "stopped", "cancelled"].includes(normalized)) {
    return normalized;
  }

  return normalized;
}

function normalizeTaskRecord(task) {
  if (!task || typeof task !== "object") {
    return null;
  }

  const taskId = normalizeLine(task.taskId);
  const prompt = normalizeLine(task.prompt);
  if (!taskId || !prompt) {
    return null;
  }

  return {
    taskId,
    prompt,
    description: normalizeLine(task.description) || null,
    sessionId: normalizeLine(task.sessionId) || null,
    taskPacket: normalizeTaskPacket(task.taskPacket),
    status: normalizeTaskStatus(task.status),
    createdAt: normalizeLine(task.createdAt) || nowIso(),
    updatedAt: normalizeLine(task.updatedAt) || nowIso(),
    messages: normalizeTaskMessages(task.messages),
    output: String(task.output ?? ""),
    agentId: normalizeLine(task.agentId) || null,
    subagentType: normalizeLine(task.subagentType) || null,
    manifestFile: normalizeLine(task.manifestFile) || null,
    outputFile: normalizeLine(task.outputFile) || null,
    sessionFile: normalizeLine(task.sessionFile) || null,
    error: normalizeLine(task.error) || null,
  };
}

function ensureTasksDir(workspaceRoot) {
  const tasksDir = resolveWorkspaceScopedDclawChildPath(workspaceRoot, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  return tasksDir;
}

function registryPath(workspaceRoot) {
  return `${ensureTasksDir(workspaceRoot)}/registry.json`;
}

function readRegistry(workspaceRoot) {
  const filePath = registryPath(workspaceRoot);
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload.map(normalizeTaskRecord).filter(Boolean);
  } catch {
    return [];
  }
}

function writeRegistry(workspaceRoot, tasks) {
  const filePath = registryPath(workspaceRoot);
  mkdirSync(ensureTasksDir(workspaceRoot), { recursive: true });
  writeFileSync(filePath, JSON.stringify(tasks, null, 2), "utf8");
  return filePath;
}

export function taskRegistryPath(workspaceRoot) {
  return registryPath(workspaceRoot);
}

export function listRegisteredTasks(workspaceRoot) {
  return readRegistry(workspaceRoot);
}

function shouldIncludeTask(task, { sessionId = null } = {}) {
  const normalizedSessionId = normalizeLine(sessionId);
  if (!normalizedSessionId) {
    return true;
  }

  return task.sessionId === normalizedSessionId;
}

export function listRegisteredTasksForSession(workspaceRoot, sessionId) {
  return readRegistry(workspaceRoot).filter((task) => shouldIncludeTask(task, { sessionId }));
}

export function getRegisteredTask(workspaceRoot, taskId, { sessionId = null } = {}) {
  const normalizedTaskId = normalizeLine(taskId);
  if (!normalizedTaskId) {
    return null;
  }

  return (
    readRegistry(workspaceRoot).find(
      (task) => task.taskId === normalizedTaskId && shouldIncludeTask(task, { sessionId }),
    ) ?? null
  );
}

export function createRegisteredTask(workspaceRoot, task) {
  const normalized = normalizeTaskRecord(task);
  if (!normalized) {
    throw new Error("task record must include taskId and prompt");
  }

  const tasks = readRegistry(workspaceRoot).filter((entry) => entry.taskId !== normalized.taskId);
  tasks.push(normalized);
  writeRegistry(workspaceRoot, tasks);
  return normalized;
}

export function createRegisteredPromptTask(
  workspaceRoot,
  { prompt, description = null, sessionId = null } = {},
) {
  const normalizedPrompt = normalizeLine(prompt);
  if (!normalizedPrompt) {
    throw new Error("prompt must not be empty");
  }

  return createRegisteredTask(workspaceRoot, {
    taskId: createTaskId(),
    prompt: normalizedPrompt,
    description: normalizeLine(description) || null,
    sessionId: normalizeLine(sessionId) || null,
    taskPacket: null,
    status: "created",
    messages: [],
    output: "",
    error: null,
  });
}

export function createRegisteredTaskFromPacket(workspaceRoot, taskPacket, { sessionId = null } = {}) {
  const { packet, errors } = validateStructuredTaskPacket(taskPacket);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return createRegisteredTask(workspaceRoot, {
    taskId: createTaskId(),
    prompt: packet.objective,
    description: packet.scope,
    sessionId: normalizeLine(sessionId) || null,
    taskPacket: packet,
    status: "created",
    messages: [],
    output: "",
    error: null,
  });
}

export function stopRegisteredTask(workspaceRoot, taskId, { sessionId = null } = {}) {
  const current = getRegisteredTask(workspaceRoot, taskId, { sessionId });
  if (!current) {
    throw new Error(`task not found: ${normalizeLine(taskId)}`);
  }

  if (["completed", "failed", "stopped", "cancelled"].includes(current.status)) {
    throw new Error(`task ${current.taskId} is already in terminal state: ${current.status}`);
  }

  return updateRegisteredTask(workspaceRoot, current.taskId, {
    status: "stopped",
    updatedAt: nowIso(),
  });
}

export function appendRegisteredTaskMessage(workspaceRoot, taskId, message, role = "user") {
  const current = getRegisteredTask(workspaceRoot, taskId);
  if (!current) {
    throw new Error(`task not found: ${normalizeLine(taskId)}`);
  }

  const normalizedContent = normalizeLine(message);
  if (!normalizedContent) {
    throw new Error("message must not be empty");
  }

  return updateRegisteredTask(workspaceRoot, current.taskId, {
    updatedAt: nowIso(),
    messages: [
      ...current.messages,
      {
        role,
        content: normalizedContent,
        createdAt: nowIso(),
      },
    ],
  });
}

export function appendRegisteredTaskMessageForSession(
  workspaceRoot,
  taskId,
  message,
  role = "user",
  { sessionId = null } = {},
) {
  const current = getRegisteredTask(workspaceRoot, taskId, { sessionId });
  if (!current) {
    throw new Error(`task not found: ${normalizeLine(taskId)}`);
  }

  const normalizedContent = normalizeLine(message);
  if (!normalizedContent) {
    throw new Error("message must not be empty");
  }

  return updateRegisteredTask(workspaceRoot, current.taskId, {
    updatedAt: nowIso(),
    messages: [
      ...current.messages,
      {
        role,
        content: normalizedContent,
        createdAt: nowIso(),
      },
    ],
  });
}

export function updateRegisteredTask(workspaceRoot, taskId, updates = {}) {
  const normalizedTaskId = normalizeLine(taskId);
  if (!normalizedTaskId) {
    throw new Error("taskId must not be empty");
  }

  const tasks = readRegistry(workspaceRoot);
  const index = tasks.findIndex((task) => task.taskId === normalizedTaskId);
  if (index === -1) {
    throw new Error(`task not found: ${normalizedTaskId}`);
  }

  const current = tasks[index];
  const next = normalizeTaskRecord({
    ...current,
    ...updates,
    taskId: current.taskId,
    prompt: updates.prompt ?? current.prompt,
    updatedAt: updates.updatedAt ?? nowIso(),
    messages: updates.messages ?? current.messages,
  });

  tasks[index] = next;
  writeRegistry(workspaceRoot, tasks);
  return next;
}
