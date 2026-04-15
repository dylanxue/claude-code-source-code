import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { registerDefaultTools } from "../src/bootstrap/register-default-tools.js";
import { AgentRuntime } from "../src/core/agent-runtime.js";
import { createBackgroundWorkerControl } from "../src/core/worker-control.js";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { listFilesTool } from "../src/tools/list-files.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-agent-runtime-tests");

function lastToolResult(messages, toolName) {
  return [...messages]
    .reverse()
    .find((message) => message.role === "tool" && message.content?.toolName === toolName && message.content?.ok)
    ?.content?.content ?? null;
}

function createReadmeExplorerModel() {
  return {
    async decide({ messages }) {
      const lastTool = [...messages]
        .reverse()
        .find((message) => message.role === "tool" && message.content?.toolName === "read_file" && message.content?.ok);

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
        output: `README.md 第一行是：\`${payload.file.content.split("\n")[0]}\``,
      };
    },
  };
}

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("agent runtime records a structured decision journal for tool and final iterations", async () => {
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(listFilesTool);

  let callCount = 0;
  const events = [];
  const runtime = new AgentRuntime({
    session: new Session(),
    model: {
      async decide() {
        callCount += 1;
        if (callCount === 1) {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "list_files",
                input: { path: "src" },
                toolCallId: "tool-1",
              },
            ],
            preflight: {
              estimatedInputTokens: 100,
              estimatedTotalTokens: 200,
              contextWindowTokens: 1000,
              exceeded: false,
            },
          };
        }

        return {
          type: "final",
          output: "done",
          finishReason: "stop",
          warnings: [],
          preflight: {
            estimatedInputTokens: 120,
            estimatedTotalTokens: 210,
            contextWindowTokens: 1000,
            exceeded: false,
          },
        };
      },
    },
    toolRegistry,
    systemPrompt: "test",
    workspaceRoot,
    onRuntimeEvent(event) {
      events.push(event);
    },
  });

  const result = await runtime.run("列出 src 然后结束", { workspaceRoot });

  assert.equal(result.output, "done");
  assert.equal(result.decisionJournal.length, 3);

  assert.deepEqual(
    result.decisionJournal.map((entry) => entry.kind),
    ["model_decision", "tool_results", "model_decision"],
  );

  assert.equal(result.decisionJournal[0].decisionType, "tools");
  assert.equal(result.decisionJournal[0].toolCallCount, 1);
  assert.equal(result.decisionJournal[1].okCount, 1);
  assert.equal(result.decisionJournal[1].blockedCount, 0);
  assert.equal(result.decisionJournal[2].decisionType, "final");

  const runtimeDecisionEvents = events.filter((event) => event.channel === "runtime_decision");
  assert.equal(runtimeDecisionEvents.length, 3);
  assert.equal(runtimeDecisionEvents[0].decisionType, "tools");
  assert.equal(runtimeDecisionEvents[2].decisionType, "final");
});

test("agent runtime forces a final-only pass when tool iterations are exhausted", async () => {
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(listFilesTool);

  let callCount = 0;
  const runtime = new AgentRuntime({
    session: new Session(),
    model: {
      async decide({ tools }) {
        callCount += 1;

        if (tools.length > 0) {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "list_files",
                input: { path: "src" },
                toolCallId: "tool-1",
              },
            ],
          };
        }

        return {
          type: "final",
          output: "forced summary",
          finishReason: "stop",
          warnings: [],
        };
      },
    },
    toolRegistry,
    systemPrompt: "test",
    workspaceRoot,
    maxIterations: 1,
  });

  const result = await runtime.run("列出 src 然后总结", { workspaceRoot });

  assert.equal(callCount, 2);
  assert.equal(result.output, "forced summary");
  assert.equal(result.iterations, 2);
  assert.equal(result.decisionJournal.length, 3);
  assert.equal(result.decisionJournal[2].decisionType, "final");
  assert.equal(result.decisionJournal[2].forcedFinalization, true);
});

test("agent runtime can follow an explicit worker-handshake input end-to-end", async () => {
  const delegatedWorkspace = path.join(tempRoot, "worker-prompt-workspace");
  await mkdir(delegatedWorkspace, { recursive: true });
  await writeFile(
    path.join(delegatedWorkspace, "README.md"),
    "# Lesson 14: Agent / Delegation Runtime\nWorker flow test.\n",
    "utf8",
  );

  const toolRegistry = registerDefaultTools(new ToolRegistry(), {
    workerControl: createBackgroundWorkerControl({
      createModel: () => createReadmeExplorerModel(),
      bootDelayMs: 5,
    }),
  });

  const userInput =
    "禁止直接使用 Agent，也禁止在调用 WorkerSendPrompt 之前结束回答。请严格按这个顺序执行：1. WorkerCreate 创建一个 Explore worker；2. WorkerAwaitReady 等到 ready_for_prompt；3. WorkerSendPrompt 把 prompt 发送给这个 worker，让它读取 README.md 第一行并做一句话总结；4. 只有拿到 WorkerSendPrompt 返回后的 worker_id、task_id 和 summary，才能给最终答案。最终答案只输出：是否完整走了 WorkerCreate -> WorkerAwaitReady -> WorkerSendPrompt、worker_id、task_id、summary。";

  const runtime = new AgentRuntime({
    session: new Session(),
    model: {
      async decide({ messages }) {
        const created = lastToolResult(messages, "WorkerCreate");
        if (!created) {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "WorkerCreate",
                input: {
                  description: "读取README.md第一行并总结",
                  prompt: "读取当前目录下的 README.md 文件的第一行，并做一句话总结。",
                  subagent_type: "Explore",
                },
                toolCallId: "worker-create",
              },
            ],
          };
        }

        const ready = lastToolResult(messages, "WorkerAwaitReady");
        if (!ready || ready.status === "spawning") {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "WorkerAwaitReady",
                input: {
                  worker_id: created.worker_id,
                  timeout_ms: 1000,
                  poll_interval_ms: 10,
                },
                toolCallId: "worker-await",
              },
            ],
          };
        }

        const sent = lastToolResult(messages, "WorkerSendPrompt");
        if (!sent) {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "WorkerSendPrompt",
                input: {
                  worker_id: created.worker_id,
                },
                toolCallId: "worker-send",
              },
            ],
          };
        }

        const current = lastToolResult(messages, "WorkerGet");
        if (!current || current.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "WorkerGet",
                input: {
                  worker_id: created.worker_id,
                },
                toolCallId: "worker-get",
              },
            ],
          };
        }

        return {
          type: "final",
          finishReason: "stop",
          warnings: [],
          output: [
            "是否完整走了 WorkerCreate -> WorkerAwaitReady -> WorkerSendPrompt：是",
            `worker_id：${current.worker_id}`,
            `task_id：${current.task_id}`,
            `summary：${current.result}`,
          ].join("\n"),
        };
      },
    },
    toolRegistry,
    systemPrompt: "test",
    workspaceRoot: delegatedWorkspace,
    maxIterations: 16,
  });

  const result = await runtime.run(userInput, {
    workspaceRoot: delegatedWorkspace,
    sessionId: runtime.session.sessionId,
  });

  assert.match(result.output, /WorkerCreate -> WorkerAwaitReady -> WorkerSendPrompt：是/);
  assert.match(result.output, /worker_id：worker-/);
  assert.match(result.output, /task_id：task-/);
  assert.match(result.output, /README.md 第一行是：`# Lesson 14: Agent \/ Delegation Runtime`/);
});
