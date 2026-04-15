import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runTaskPacketTool } from "../src/tools/run-task-packet.js";
import { taskCreateTool } from "../src/tools/task-create.js";
import { taskGetTool } from "../src/tools/task-get.js";
import { taskListTool } from "../src/tools/task-list.js";
import { taskOutputTool } from "../src/tools/task-output.js";
import { taskStopTool } from "../src/tools/task-stop.js";
import { taskUpdateTool } from "../src/tools/task-update.js";
import { createRegisteredTask, createTaskId } from "../src/core/task-registry.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-task-tool-tests");

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("TaskGet, TaskList, TaskUpdate, and TaskOutput expose registry-backed task state", async () => {
  const delegatedWorkspace = path.join(tempRoot, "task-tools-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });
  const sessionId = "session-main";

  const taskId = createTaskId();
  createRegisteredTask(delegatedWorkspace, {
    taskId,
    prompt: "Analyze lesson1",
    description: "Explore lesson1",
    sessionId,
    taskPacket: {
      objective: "Analyze lesson1",
      scope: "Only analyze lesson1.",
      acceptance: ["Return a concise verdict."],
      outOfScope: ["Do not expand to lesson2 or later."],
    },
    status: "running",
    messages: [
      {
        role: "user",
        content: "Analyze lesson1",
      },
    ],
    output: "partial output",
  });

  const listed = await taskListTool.execute({}, { workspaceRoot: delegatedWorkspace, sessionId });
  assert.equal(listed.count, 1);
  assert.equal(listed.tasks[0].task_id, taskId);

  const fetched = await taskGetTool.execute(
    { task_id: taskId },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(fetched.task_id, taskId);
  assert.equal(fetched.status, "running");
  assert.equal(fetched.task_packet.scope, "Only analyze lesson1.");

  const updated = await taskUpdateTool.execute(
    { task_id: taskId, message: "Please focus on README parity." },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(updated.task_id, taskId);
  assert.equal(updated.message_count, 2);

  const output = await taskOutputTool.execute(
    { task_id: taskId },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(output.task_id, taskId);
  assert.equal(output.output, "partial output");
  assert.equal(output.has_output, true);
});

test("TaskStop marks a running task as stopped", async () => {
  const delegatedWorkspace = path.join(tempRoot, "task-stop-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });
  const sessionId = "session-main";

  const taskId = createTaskId();
  createRegisteredTask(delegatedWorkspace, {
    taskId,
    prompt: "Analyze lesson2",
    description: "Explore lesson2",
    sessionId,
    status: "running",
    messages: [],
    output: "",
  });

  const stopped = await taskStopTool.execute(
    { task_id: taskId },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(stopped.task_id, taskId);
  assert.equal(stopped.status, "stopped");
});

test("TaskCreate and RunTaskPacket create claw-code style created tasks", async () => {
  const delegatedWorkspace = path.join(tempRoot, "task-create-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });
  const sessionId = "session-main";

  const created = await taskCreateTool.execute(
    {
      prompt: "Investigate lesson14 parity gaps",
      description: "background task",
    },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(created.status, "created");
  assert.equal(created.prompt, "Investigate lesson14 parity gaps");
  assert.equal(created.description, "background task");
  assert.equal(created.task_packet, null);

  const packet = await runTaskPacketTool.execute(
    {
      objective: "Audit structured task packets",
      scope: "lesson14 task runtime",
      repo: "claw-code",
      branch_policy: "stay on current branch",
      acceptance_tests: ["npm test", "npm run smoke"],
      commit_policy: "do not commit unless asked",
      reporting_contract: "report task ids and verification",
      escalation_policy: "stop on destructive ambiguity",
    },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(packet.status, "created");
  assert.equal(packet.prompt, "Audit structured task packets");
  assert.equal(packet.description, "lesson14 task runtime");
  assert.deepEqual(packet.task_packet.acceptanceTests, ["npm test", "npm run smoke"]);
});

test("TaskList only returns tasks for the current session", async () => {
  const delegatedWorkspace = path.join(tempRoot, "task-session-scope-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  createRegisteredTask(delegatedWorkspace, {
    taskId: createTaskId(),
    prompt: "Analyze lesson1",
    description: "session a",
    sessionId: "session-a",
    status: "running",
    messages: [],
    output: "",
  });
  createRegisteredTask(delegatedWorkspace, {
    taskId: createTaskId(),
    prompt: "Analyze lesson2",
    description: "session b",
    sessionId: "session-b",
    status: "running",
    messages: [],
    output: "",
  });

  const listedA = await taskListTool.execute({}, { workspaceRoot: delegatedWorkspace, sessionId: "session-a" });
  const listedB = await taskListTool.execute({}, { workspaceRoot: delegatedWorkspace, sessionId: "session-b" });

  assert.equal(listedA.count, 1);
  assert.equal(listedA.tasks[0].description, "session a");
  assert.equal(listedB.count, 1);
  assert.equal(listedB.tasks[0].description, "session b");

  await assert.rejects(
    () => taskGetTool.execute({ task_id: listedA.tasks[0].task_id }, { workspaceRoot: delegatedWorkspace, sessionId: "session-b" }),
    /task not found/,
  );
});
