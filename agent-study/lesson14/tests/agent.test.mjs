import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createBackgroundSubagentRunner, createSubagentRunner } from "../src/core/subagent-runner.js";
import { getRegisteredTask, stopRegisteredTask } from "../src/core/task-registry.js";
import { allowedToolsForSubagent, normalizeSubagentType } from "../src/core/subagent-types.js";
import { createAgentTool } from "../src/tools/agent.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-agent-tests");

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
        output: `Explore summary: ${payload.file.filePath} -> ${payload.file.content.split("\n")[0]}`,
      };
    },
  };
}

function createWriteAttemptModel() {
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
              toolName: "write_file",
              input: {
                path: "should-not-exist.txt",
                content: "blocked",
              },
              toolCallId: "tool-write",
            },
          ],
        };
      }

      return {
        type: "final",
        finishReason: "stop",
        warnings: [],
        output: `Tool failure captured: ${lastTool.content.error}`,
      };
    },
  };
}

function createDelayedExplorerModel(delayMs = 25) {
  return {
    async decide({ messages }) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return createReadmeExplorerModel().decide({ messages });
    },
  };
}

function createFailingModel(message = "tool failed: simulated failure") {
  return {
    async decide() {
      throw new Error(message);
    },
  };
}

async function waitForTaskStatus(workspaceRoot, taskId, expectedStatus, timeoutMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const task = getRegisteredTask(workspaceRoot, taskId);
    if (task?.status === expectedStatus) {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for task ${taskId} to reach status ${expectedStatus}`);
}

async function waitForManifestStatus(manifestFile, expectedStatus, timeoutMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      if (manifest?.status === expectedStatus) {
        return manifest;
      }
    } catch {
      // Background writes are not atomic yet; retry until the file stabilizes.
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for manifest ${manifestFile} to reach status ${expectedStatus}`);
}

test("normalizeSubagentType maps built-in aliases to canonical lesson14 names", () => {
  assert.equal(normalizeSubagentType(), "general-purpose");
  assert.equal(normalizeSubagentType("explorer"), "Explore");
  assert.equal(normalizeSubagentType("planagent"), "Plan");
  assert.equal(normalizeSubagentType("verify"), "Verification");
});

test("allowedToolsForSubagent enforces lesson14 role boundaries", () => {
  const general = allowedToolsForSubagent("general-purpose");
  const explore = allowedToolsForSubagent("Explore");
  const plan = allowedToolsForSubagent("Plan");
  const verification = allowedToolsForSubagent("Verification");

  assert.equal(general.has("bash"), true);
  assert.equal(general.has("write_file"), true);
  assert.equal(general.has("Agent"), false);

  assert.equal(explore.has("read_file"), true);
  assert.equal(explore.has("bash"), false);
  assert.equal(explore.has("write_file"), false);

  assert.equal(plan.has("read_file"), true);
  assert.equal(plan.has("TodoWrite"), true);
  assert.equal(plan.has("StructuredOutput"), true);
  assert.equal(plan.has("write_file"), false);
  assert.equal(plan.has("bash"), false);

  assert.equal(verification.has("bash"), true);
  assert.equal(verification.has("write_file"), false);
});

test("Agent tool normalizes the requested type before delegating", async () => {
  let captured = null;
  const tool = createAgentTool({
    async runSubagent(input) {
      captured = input;
      return {
        agentId: "agent-test",
        name: "agent-test",
        description: input.description,
        subagentType: input.subagent_type,
        status: "completed",
        outputFile: "/tmp/output.md",
        manifestFile: "/tmp/manifest.json",
        sessionFile: "/tmp/session.json",
        result: "done",
        error: null,
      };
    },
  });

  const result = await tool.execute({
    description: "Audit docs",
    prompt: "Read README",
    subagent_type: "explorer",
    name: "Docs Audit",
  });

  assert.equal(captured.subagent_type, "Explore");
  assert.equal(result.subagentType, "Explore");
});

test("subagent runner executes an Explore delegate with isolated artifacts", async () => {
  const delegatedWorkspace = path.join(tempRoot, "workspace-explore");
  await mkdir(delegatedWorkspace, { recursive: true });
  await writeFile(path.join(delegatedWorkspace, "README.md"), "# Lesson 14 Test\nDelegation works.\n", "utf8");

  const runSubagent = createSubagentRunner({
    createModel: () => createReadmeExplorerModel(),
  });

  const result = await runSubagent(
    {
      description: "Explore the README",
      prompt: "Read README.md and summarize the first line.",
      subagent_type: "explorer",
      name: "README Explore",
    },
    { workspaceRoot: delegatedWorkspace },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.subagentType, "Explore");
  assert.match(result.result, /Lesson 14 Test/);

  const manifest = JSON.parse(await readFile(result.manifestFile, "utf8"));
  assert.equal(manifest.status, "completed");
  assert.equal(manifest.sessionId.startsWith("session-"), true);
  assert.equal(manifest.allowedTools.includes("read_file"), true);
  assert.equal(manifest.allowedTools.includes("write_file"), false);
  assert.equal(typeof manifest.taskId, "string");
  assert.equal(manifest.laneEvents[0].event, "lane.started");
  assert.equal(manifest.laneEvents[0].status, "running");
  assert.equal(manifest.laneEvents.at(-1).event, "lane.finished");
  assert.equal(manifest.derivedState, "finished_cleanable");
  assert.equal(manifest.currentBlocker, null);

  const registeredTask = getRegisteredTask(delegatedWorkspace, manifest.taskId);
  assert.equal(registeredTask.status, "completed");
  assert.equal(registeredTask.agentId, result.agentId);
  assert.equal(registeredTask.subagentType, "Explore");
  assert.equal(registeredTask.taskPacket.scope, "Only complete this delegated Explore task.");
  assert.match(registeredTask.output, /Lesson 14 Test/);

  const sessionStats = await stat(result.sessionFile);
  assert.equal(sessionStats.isFile(), true);
});

test("Explore delegate cannot escalate into write_file because the child registry excludes it", async () => {
  const delegatedWorkspace = path.join(tempRoot, "workspace-explore-no-write");
  await mkdir(delegatedWorkspace, { recursive: true });
  await writeFile(path.join(delegatedWorkspace, "README.md"), "# Explore only\n", "utf8");

  const runSubagent = createSubagentRunner({
    createModel: () => createWriteAttemptModel(),
  });

  const result = await runSubagent(
    {
      description: "Attempt an invalid write",
      prompt: "Try writing a file even though this is Explore.",
      subagent_type: "Explore",
    },
    { workspaceRoot: delegatedWorkspace },
  );

  assert.equal(result.status, "completed");
  assert.match(result.result, /Unknown tool: write_file/);

  await assert.rejects(
    () => stat(path.join(delegatedWorkspace, "should-not-exist.txt")),
    /ENOENT/,
  );
});

test("background subagent runner returns running first, then completes in the registry", async () => {
  const delegatedWorkspace = path.join(tempRoot, "workspace-background");
  await mkdir(delegatedWorkspace, { recursive: true });
  await writeFile(path.join(delegatedWorkspace, "README.md"), "# Background Explore\n", "utf8");

  const runSubagent = createBackgroundSubagentRunner({
    createModel: () => createReadmeExplorerModel(),
  });

  const manifest = await runSubagent(
    {
      description: "Explore asynchronously",
      prompt: "Read README.md and summarize the first line.",
      subagent_type: "Explore",
    },
    { workspaceRoot: delegatedWorkspace },
  );

  assert.equal(manifest.status, "running");
  const completedTask = await waitForTaskStatus(delegatedWorkspace, manifest.taskId, "completed");
  assert.match(completedTask.output, /Background Explore/);

  const completedManifest = await waitForManifestStatus(manifest.manifestFile, "completed");
  assert.equal(completedManifest.status, "completed");
  assert.match(completedManifest.result, /Background Explore/);
});

test("background subagent runner respects stopped tasks and does not overwrite them with completion", async () => {
  const delegatedWorkspace = path.join(tempRoot, "workspace-background-stop");
  await mkdir(delegatedWorkspace, { recursive: true });
  await writeFile(path.join(delegatedWorkspace, "README.md"), "# Stop Explore\n", "utf8");

  const runSubagent = createBackgroundSubagentRunner({
    createModel: () => createDelayedExplorerModel(),
  });

  const manifest = await runSubagent(
    {
      description: "Explore but stop early",
      prompt: "Read README.md and summarize the first line.",
      subagent_type: "Explore",
    },
    { workspaceRoot: delegatedWorkspace },
  );

  const stopped = stopRegisteredTask(delegatedWorkspace, manifest.taskId);
  assert.equal(stopped.status, "stopped");

  const stoppedTask = await waitForTaskStatus(delegatedWorkspace, manifest.taskId, "stopped");
  assert.equal(stoppedTask.status, "stopped");

  const stoppedManifest = await waitForManifestStatus(manifest.manifestFile, "stopped");
  assert.equal(stoppedManifest.status, "stopped");
  assert.equal(stoppedManifest.laneEvents[0].event, "lane.started");
  assert.equal(stoppedManifest.laneEvents.at(-1).event, "lane.closed");
  assert.equal(stoppedManifest.derivedState, "truly_idle");
  assert.equal(stoppedManifest.currentBlocker, null);
});

test("subagent runner records blocker metadata on failed background work", async () => {
  const delegatedWorkspace = path.join(tempRoot, "workspace-background-failure");
  await mkdir(delegatedWorkspace, { recursive: true });

  const runSubagent = createBackgroundSubagentRunner({
    createModel: () => createFailingModel(),
  });

  const manifest = await runSubagent(
    {
      description: "Fail in the background",
      prompt: "This will fail immediately.",
      subagent_type: "Verification",
    },
    { workspaceRoot: delegatedWorkspace },
  );

  const failedTask = await waitForTaskStatus(delegatedWorkspace, manifest.taskId, "failed");
  assert.equal(failedTask.status, "failed");

  const failedManifest = await waitForManifestStatus(manifest.manifestFile, "failed");
  assert.equal(failedManifest.laneEvents[0].event, "lane.started");
  assert.equal(failedManifest.laneEvents[1].event, "lane.blocked");
  assert.equal(failedManifest.laneEvents[2].event, "lane.failed");
  assert.equal(failedManifest.currentBlocker.failureClass, "tool_runtime");
  assert.equal(failedManifest.derivedState, "truly_idle");
});
