import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

import { AgentRuntime } from "../src/core/agent-runtime.js";
import { Session } from "../src/core/session.js";
import { inferTaskPacketFromPrompt } from "../src/core/task-packet.js";
import { ToolRegistry } from "../src/core/tool-registry.js";

const workspaceRoot = process.cwd();

test("Session preserves planState through JSON round-trips", () => {
  const session = new Session();
  session.setPlanState({
    objective: "Analyze lesson1 through lesson5",
    summary: "Explore each lesson, then synthesize a verdict.",
    targets: ["lesson1", "lesson2", "lesson3", "lesson4", "lesson5"],
    steps: ["Explore each lesson", "Compare README against code", "Write a final verdict"],
    risks: ["Do not stop after a single lesson"],
    doneWhen: ["Every lesson in scope has a verdict"],
    outOfScope: ["Do not expand to lesson6 or later"],
    todos: [
      {
        content: "Explore lesson1",
        activeForm: "Exploring lesson1",
        status: "completed",
      },
    ],
  });

  const restored = Session.fromJSON(session.toJSON());
  assert.deepEqual(restored.planState, session.planState);
});

test("Plan subagent results are persisted into session planState and injected as a plan pin", async () => {
  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: "Agent",
    description: "delegate",
    async execute() {
      return {
        agentId: "agent-plan-1",
        description: "Create a scoped analysis plan",
        subagentType: "Plan",
        status: "completed",
        result: "Plan summary: explore all scoped lessons, then synthesize a verdict.",
        structuredResult: {
          targets: ["lesson1", "lesson2", "lesson3", "lesson4", "lesson5"],
          plan: [
            "Explore lesson1",
            "Explore lesson2",
            "Explore lesson3",
            "Explore lesson4",
            "Explore lesson5",
            "Synthesize a final verdict",
          ],
          risks: ["Do not stop after verifying only one lesson."],
          done_when: ["Every lesson in scope has a documented match verdict."],
          out_of_scope: ["Do not expand to lesson6 or later."],
        },
        latestTodoState: {
          newTodos: [
            {
              content: "Explore lesson1",
              activeForm: "Exploring lesson1",
              status: "completed",
            },
            {
              content: "Synthesize final verdict",
              activeForm: "Synthesizing final verdict",
              status: "in_progress",
            },
          ],
        },
      };
    },
  });

  const capturedPrompts = [];
  let callCount = 0;
  const runtime = new AgentRuntime({
    session: new Session(),
    model: {
      async decide({ systemPrompt }) {
        capturedPrompts.push(systemPrompt);
        callCount += 1;

        if (callCount === 1) {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "Agent",
                input: {
                  description: "Create a scoped analysis plan",
                  prompt: "Plan the work for lesson1 through lesson5.",
                  subagent_type: "Plan",
                },
                toolCallId: "tool-plan-1",
              },
            ],
          };
        }

        return {
          type: "final",
          finishReason: "stop",
          warnings: [],
          output: "done",
        };
      },
    },
    toolRegistry,
    systemPrompt: "You are a coding agent.",
    workspaceRoot,
  });

  await runtime.run("逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配", {
    workspaceRoot,
    taskPacket: inferTaskPacketFromPrompt("逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配"),
  });

  assert.equal(capturedPrompts.length, 2);
  assert.match(capturedPrompts[1], /# Plan Pin/);
  assert.match(capturedPrompts[1], /Synthesize a final verdict/);
  assert.match(capturedPrompts[1], /Do not expand to lesson6 or later/);
  assert.deepEqual(runtime.session.planState.targets, [
    "lesson1",
    "lesson2",
    "lesson3",
    "lesson4",
    "lesson5",
  ]);
  assert.equal(runtime.session.planState.todos.length, 2);
});
