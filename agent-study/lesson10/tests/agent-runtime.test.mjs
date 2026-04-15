import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

import { AgentRuntime } from "../src/core/agent-runtime.js";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { listFilesTool } from "../src/tools/list-files.js";

const workspaceRoot = process.cwd();

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
