import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { resolveWorkspaceScopedDclawChildPath } from "../src/config/dclaw-paths.js";
import { createSubagentRunner } from "../src/core/subagent-runner.js";
import { structuredOutputTool } from "../src/tools/structured-output.js";
import { todoWriteTool } from "../src/tools/todo-write.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-planning-tool-tests");

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function lastToolMessage(messages) {
  return [...messages].reverse().find((message) => message.role === "tool");
}

function createPlanModel() {
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
              toolName: "TodoWrite",
              input: {
                todos: [
                  {
                    content: "Read the README",
                    activeForm: "Reading the README",
                    status: "completed",
                  },
                  {
                    content: "Draft an implementation plan",
                    activeForm: "Drafting an implementation plan",
                    status: "in_progress",
                  },
                ],
              },
              toolCallId: "todo-write-1",
            },
          ],
        };
      }

      if (lastTool.content.toolName === "TodoWrite") {
        return {
          type: "tools",
          finishReason: "tool_calls",
          warnings: [],
          toolCalls: [
            {
              toolName: "StructuredOutput",
              input: {
                plan: [
                  "Review current code paths",
                  "Implement the smallest safe change",
                  "Run focused validation",
                ],
                risks: ["Missing edge-case coverage"],
              },
              toolCallId: "structured-output-1",
            },
          ],
        };
      }

      const payload = lastTool.content.content;
      return {
        type: "final",
        finishReason: "stop",
        warnings: [],
        output: `Plan summary: ${payload.structured_output.plan.length} steps, ${payload.structured_output.risks.length} risk.`,
      };
    },
  };
}

test("TodoWrite persists and returns previous todo state", async () => {
  const delegatedWorkspace = path.join(tempRoot, "todo-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  const first = await todoWriteTool.execute(
    {
      todos: [
        {
          content: "Inspect files",
          activeForm: "Inspecting files",
          status: "in_progress",
        },
      ],
    },
    { workspaceRoot: delegatedWorkspace },
  );

  assert.deepEqual(first.oldTodos, []);
  assert.equal(first.newTodos.length, 1);
  assert.equal(first.verificationNudgeNeeded, null);

  const second = await todoWriteTool.execute(
    {
      todos: [
        {
          content: "Inspect files",
          activeForm: "Inspecting files",
          status: "completed",
        },
        {
          content: "Implement changes",
          activeForm: "Implementing changes",
          status: "completed",
        },
        {
          content: "Write tests",
          activeForm: "Writing tests",
          status: "completed",
        },
      ],
    },
    { workspaceRoot: delegatedWorkspace },
  );

  assert.equal(second.oldTodos.length, 1);
  assert.equal(second.newTodos.length, 3);
  assert.equal(second.verificationNudgeNeeded, true);

  const persisted = JSON.parse(
    await readFile(resolveWorkspaceScopedDclawChildPath(delegatedWorkspace, "todos", "todos.json"), "utf8"),
  );
  assert.deepEqual(persisted, []);
});

test("TodoWrite falls back to content when activeForm is omitted", async () => {
  const delegatedWorkspace = path.join(tempRoot, "todo-fallback-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  const result = await todoWriteTool.execute(
    {
      todos: [
        {
          content: "Inspect files",
          status: "in_progress",
        },
      ],
    },
    { workspaceRoot: delegatedWorkspace },
  );

  assert.equal(result.newTodos.length, 1);
  assert.equal(result.newTodos[0].content, "Inspect files");
  assert.equal(result.newTodos[0].activeForm, "Inspect files");
});

test("StructuredOutput returns the payload in a rust-style envelope", async () => {
  const result = await structuredOutputTool.execute({
    ok: true,
    items: [1, 2, 3],
  });

  assert.equal(result.data, "Structured output provided successfully");
  assert.deepEqual(result.structured_output, {
    ok: true,
    items: [1, 2, 3],
  });

  await assert.rejects(
    () => structuredOutputTool.execute({}),
    /structured output payload must not be empty/,
  );
});

test("Plan subagent can use TodoWrite and StructuredOutput in the child runtime", async () => {
  const delegatedWorkspace = path.join(tempRoot, "plan-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });

  const runSubagent = createSubagentRunner({
    createModel: () => createPlanModel(),
  });

  const result = await runSubagent(
    {
      description: "Create a small implementation plan",
      prompt: "Plan the next three steps and persist the current todo list.",
      subagent_type: "Plan",
      name: "Plan Worker",
    },
    { workspaceRoot: delegatedWorkspace },
  );

  assert.equal(result.status, "completed");
  assert.match(result.result, /Plan summary: 3 steps, 1 risk/);
  assert.deepEqual(result.structuredResult.plan, [
    "Review current code paths",
    "Implement the smallest safe change",
    "Run focused validation",
  ]);
  assert.equal(result.latestTodoState.newTodos.length, 2);

  const manifest = JSON.parse(await readFile(result.manifestFile, "utf8"));
  assert.equal(manifest.allowedTools.includes("TodoWrite"), true);
  assert.equal(manifest.allowedTools.includes("StructuredOutput"), true);
  assert.deepEqual(manifest.structuredResult.plan, result.structuredResult.plan);

  const persisted = JSON.parse(
    await readFile(resolveWorkspaceScopedDclawChildPath(delegatedWorkspace, "todos", "todos.json"), "utf8"),
  );
  assert.equal(persisted.length, 2);
});
