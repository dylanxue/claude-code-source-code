import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { registerDefaultTools } from "../src/bootstrap/register-default-tools.js";
import { createBackgroundWorkerControl } from "../src/core/worker-control.js";
import { getRegisteredTask } from "../src/core/task-registry.js";
import { ToolRegistry } from "../src/core/tool-registry.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-worker-tool-tests");

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function lastToolMessage(messages) {
  return [...messages].reverse().find((message) => message.role === "tool");
}

function createReadmeExplorerModel() {
  return {
    async decide({ messages }) {
      const lastTool = lastToolMessage(messages);

      if (!lastTool) {
        return {
          type: "tools",
          finishReason: "tool_calls",
          warnings: [],
          toolCalls: [
            {
              toolName: "read_file",
              input: { path: "README.md" },
              toolCallId: "tool-readme",
            },
          ],
        };
      }

      const payload = lastTool.content.content;
      return {
        type: "final",
        finishReason: "stop",
        warnings: [],
        output: `Worker summary: ${payload.file.content.split("\n")[0]}`,
      };
    },
  };
}

async function waitForWorkerStatus(toolRegistry, delegatedWorkspace, workerId, expectedStatus, timeoutMs = 1000) {
  const startedAt = Date.now();
  const sessionId = "session-main";

  while (Date.now() - startedAt < timeoutMs) {
    const worker = await toolRegistry.execute(
      "WorkerGet",
      { worker_id: workerId },
      { workspaceRoot: delegatedWorkspace, sessionId },
    );
    if (worker.status === expectedStatus) {
      return worker;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for worker ${workerId} to reach status ${expectedStatus}`);
}

test("Worker lifecycle tools create a ready handshake and run the delegated worker after prompt delivery", async () => {
  const delegatedWorkspace = path.join(tempRoot, "worker-flow-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });
  await writeFile(path.join(delegatedWorkspace, "README.md"), "# Worker Flow\nLifecycle works.\n", "utf8");
  const sessionId = "session-main";

  const toolRegistry = registerDefaultTools(new ToolRegistry(), {
    workerControl: createBackgroundWorkerControl({
      createModel: () => createReadmeExplorerModel(),
      bootDelayMs: 5,
    }),
  });

  const created = await toolRegistry.execute(
    "WorkerCreate",
    {
      description: "Explore README via worker lifecycle",
      prompt: "Read README.md and summarize the first heading.",
      subagent_type: "explorer",
      name: "README worker",
    },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(created.status, "spawning");
  assert.equal(created.ready, false);
  assert.equal(created.task_id, null);
  assert.equal(created.session_id, sessionId);

  const ready = await toolRegistry.execute(
    "WorkerAwaitReady",
    {
      worker_id: created.worker_id,
      timeout_ms: 500,
      poll_interval_ms: 10,
    },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(ready.status, "ready_for_prompt");
  assert.equal(ready.ready, true);
  assert.equal(ready.timed_out, false);

  const running = await toolRegistry.execute(
    "WorkerSendPrompt",
    {
      worker_id: created.worker_id,
    },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(running.status, "running");
  assert.equal(typeof running.task_id, "string");
  assert.equal(typeof running.agent_id, "string");
  assert.equal(running.prompt_in_flight, true);

  const finished = await waitForWorkerStatus(toolRegistry, delegatedWorkspace, created.worker_id, "finished");
  assert.equal(finished.terminal_reason, "completed");
  assert.match(finished.result, /Worker Flow/);
  assert.equal(finished.prompt_in_flight, false);

  const stateSnapshot = JSON.parse(await readFile(finished.state_file, "utf8"));
  assert.equal(stateSnapshot.status, "finished");
  assert.equal(stateSnapshot.task_id, finished.task_id);
  assert.equal(stateSnapshot.agent_id, finished.agent_id);
  assert.equal(stateSnapshot.session_id, sessionId);

  const task = getRegisteredTask(delegatedWorkspace, finished.task_id);
  assert.equal(task.status, "completed");
  assert.match(task.output, /Worker Flow/);
});

test("WorkerSendPrompt rejects prompt delivery before the worker reaches ready_for_prompt", async () => {
  const delegatedWorkspace = path.join(tempRoot, "worker-not-ready-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });
  const sessionId = "session-main";

  const toolRegistry = registerDefaultTools(new ToolRegistry(), {
    workerControl: createBackgroundWorkerControl({
      createModel: () => createReadmeExplorerModel(),
      bootDelayMs: 200,
    }),
  });

  const created = await toolRegistry.execute(
    "WorkerCreate",
    {
      description: "Delay worker boot",
      prompt: "Read README.md later.",
      subagent_type: "Explore",
    },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );

  await assert.rejects(
    () =>
      toolRegistry.execute(
        "WorkerSendPrompt",
        { worker_id: created.worker_id },
        { workspaceRoot: delegatedWorkspace, sessionId },
      ),
    /not ready for prompt delivery/,
  );

  const timedOut = await toolRegistry.execute(
    "WorkerAwaitReady",
    {
      worker_id: created.worker_id,
      timeout_ms: 20,
      poll_interval_ms: 10,
    },
    { workspaceRoot: delegatedWorkspace, sessionId },
  );
  assert.equal(timedOut.status, "spawning");
  assert.equal(timedOut.ready, false);
  assert.equal(timedOut.timed_out, true);
});

test("Worker tools are scoped to the creating session", async () => {
  const delegatedWorkspace = path.join(tempRoot, "worker-session-scope-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  const toolRegistry = registerDefaultTools(new ToolRegistry(), {
    workerControl: createBackgroundWorkerControl({
      createModel: () => createReadmeExplorerModel(),
      bootDelayMs: 5,
    }),
  });

  const created = await toolRegistry.execute(
    "WorkerCreate",
    {
      description: "Session-owned worker",
      prompt: "Read README.md and summarize the first heading.",
      subagent_type: "explorer",
    },
    { workspaceRoot: delegatedWorkspace, sessionId: "session-a" },
  );

  await assert.rejects(
    () =>
      toolRegistry.execute(
        "WorkerGet",
        { worker_id: created.worker_id },
        { workspaceRoot: delegatedWorkspace, sessionId: "session-b" },
      ),
    /worker not found/,
  );

  await assert.rejects(
    () =>
      toolRegistry.execute(
        "WorkerSendPrompt",
        { worker_id: created.worker_id },
        { workspaceRoot: delegatedWorkspace, sessionId: "session-b" },
      ),
    /worker not found/,
  );
});
