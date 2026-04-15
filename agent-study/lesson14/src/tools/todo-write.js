import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspaceScopedDclawChildPath } from "../config/dclaw-paths.js";

const VALID_TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

function fallbackActiveForm(content) {
  return String(content ?? "").trim();
}

function normalizeTodoItem(rawTodo, index) {
  if (typeof rawTodo !== "object" || rawTodo === null || Array.isArray(rawTodo)) {
    throw new Error(`todo at index ${index} must be an object`);
  }

  const content = String(rawTodo.content ?? "").trim();
  const activeForm = String(rawTodo.activeForm ?? "").trim() || fallbackActiveForm(content);
  const status = String(rawTodo.status ?? "").trim();

  if (!content) {
    throw new Error("todo content must not be empty");
  }

  if (!VALID_TODO_STATUSES.has(status)) {
    throw new Error(`todo status must be one of: ${[...VALID_TODO_STATUSES].join(", ")}`);
  }

  return {
    content,
    activeForm,
    status,
  };
}

function verificationNudgeNeeded(todos) {
  const allDone = todos.every((todo) => todo.status === "completed");
  if (!allDone || todos.length < 3) {
    return null;
  }

  return todos.some((todo) => todo.content.toLowerCase().includes("verif")) ? null : true;
}

async function todoStorePath(workspaceRoot) {
  const storePath = resolveWorkspaceScopedDclawChildPath(workspaceRoot, "todos", "todos.json");
  await mkdir(path.dirname(storePath), { recursive: true });
  return storePath;
}

async function readOldTodos(storePath) {
  try {
    const payload = await readFile(storePath, "utf8");
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const todoWriteTool = {
  name: "TodoWrite",
  family: "planning",
  description: "Update the structured task list for the current session.",
  inputSchema: {
    type: "object",
    required: ["todos"],
    properties: {
      todos: { type: "array" },
    },
  },
  async execute(input, context) {
    const rawTodos = Array.isArray(input.todos) ? input.todos : null;
    if (!rawTodos || rawTodos.length === 0) {
      throw new Error("todos must not be empty");
    }

    const todos = rawTodos.map((todo, index) => normalizeTodoItem(todo, index));
    const storePath = await todoStorePath(context.workspaceRoot);
    const oldTodos = await readOldTodos(storePath);
    const allDone = todos.every((todo) => todo.status === "completed");
    const persistedTodos = allDone ? [] : todos;

    await writeFile(storePath, JSON.stringify(persistedTodos, null, 2), "utf8");

    return {
      oldTodos,
      newTodos: todos,
      verificationNudgeNeeded: verificationNudgeNeeded(todos),
      storePath,
    };
  },
};
