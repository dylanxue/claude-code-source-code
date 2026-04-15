import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  createRegisteredTask,
  createRegisteredTaskFromPacket,
  createRegisteredPromptTask,
  createTaskId,
  getRegisteredTask,
  listRegisteredTasks,
  listRegisteredTasksForSession,
  taskRegistryPath,
  updateRegisteredTask,
} from "../src/core/task-registry.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-task-registry-tests");

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("task registry persists created and updated task records", async () => {
  const delegatedWorkspace = path.join(tempRoot, "registry-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  const taskId = createTaskId();
  const created = createRegisteredTask(delegatedWorkspace, {
    taskId,
    prompt: "Analyze lesson1 through lesson5",
    description: "Create a delegation plan",
    sessionId: "session-main",
    taskPacket: {
      objective: "Analyze lesson1 through lesson5",
      scope: "Only analyze lesson1 through lesson5.",
      acceptance: ["Cover each lesson in scope."],
      outOfScope: ["Do not expand to lesson6 or later."],
    },
    status: "running",
    messages: [
      {
        role: "user",
        content: "Analyze lesson1 through lesson5",
      },
    ],
    output: "",
  });

  assert.equal(created.taskId, taskId);
  assert.equal(listRegisteredTasks(delegatedWorkspace).length, 1);
  assert.equal(created.sessionId, "session-main");

  const updated = updateRegisteredTask(delegatedWorkspace, taskId, {
    status: "completed",
    output: "done",
    messages: [
      {
        role: "user",
        content: "Analyze lesson1 through lesson5",
      },
      {
        role: "assistant",
        content: "done",
      },
    ],
  });

  assert.equal(updated.status, "completed");
  assert.equal(updated.output, "done");
  assert.equal(getRegisteredTask(delegatedWorkspace, taskId).messages.length, 2);

  const persisted = JSON.parse(await readFile(taskRegistryPath(delegatedWorkspace), "utf8"));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].status, "completed");
  assert.equal(persisted[0].sessionId, "session-main");
});

test("task registry can create prompt and packet-backed created tasks", async () => {
  const delegatedWorkspace = path.join(tempRoot, "registry-packet-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  const promptTask = createRegisteredPromptTask(delegatedWorkspace, {
    prompt: "Investigate lesson14 task runtime",
    description: "background investigation",
    sessionId: "session-alpha",
  });
  assert.equal(promptTask.status, "created");
  assert.equal(promptTask.prompt, "Investigate lesson14 task runtime");
  assert.equal(promptTask.description, "background investigation");

  const packetTask = createRegisteredTaskFromPacket(delegatedWorkspace, {
    objective: "Audit task packet parity",
    scope: "lesson14 task runtime",
    repo: "claw-code",
    branch_policy: "stay on current branch",
    acceptance_tests: ["npm test", "npm run smoke"],
    commit_policy: "do not commit unless asked",
    reporting_contract: "report task id and verification",
    escalation_policy: "stop on destructive ambiguity",
  }, { sessionId: "session-beta" });

  assert.equal(packetTask.status, "created");
  assert.equal(packetTask.prompt, "Audit task packet parity");
  assert.equal(packetTask.description, "lesson14 task runtime");
  assert.deepEqual(packetTask.taskPacket.acceptanceTests, ["npm test", "npm run smoke"]);
  assert.equal(listRegisteredTasks(delegatedWorkspace).length, 2);
});

test("task registry can filter tasks by owning session", async () => {
  const delegatedWorkspace = path.join(tempRoot, "registry-session-filter-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  createRegisteredPromptTask(delegatedWorkspace, {
    prompt: "Analyze lesson1",
    description: "session a",
    sessionId: "session-a",
  });
  createRegisteredPromptTask(delegatedWorkspace, {
    prompt: "Analyze lesson2",
    description: "session b",
    sessionId: "session-b",
  });

  assert.equal(listRegisteredTasksForSession(delegatedWorkspace, "session-a").length, 1);
  assert.equal(listRegisteredTasksForSession(delegatedWorkspace, "session-b").length, 1);
  assert.equal(listRegisteredTasksForSession(delegatedWorkspace, "session-missing").length, 0);
  assert.equal(listRegisteredTasks(delegatedWorkspace).length, 2);
});
