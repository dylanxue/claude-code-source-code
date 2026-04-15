import test from "node:test";
import assert from "node:assert/strict";

import { AgentRuntime } from "../src/core/agent-runtime.js";
import { compactSession } from "../src/core/session-compaction.js";
import { Session } from "../src/core/session.js";
import {
  inferTaskPacketFromPrompt,
  validateStructuredTaskPacket,
} from "../src/core/task-packet.js";
import { ToolRegistry } from "../src/core/tool-registry.js";

const workspaceRoot = process.cwd();

test("inferTaskPacketFromPrompt captures lesson scope and anti-drift boundaries", () => {
  const taskPacket = inferTaskPacketFromPrompt(
    "逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配",
  );

  assert.equal(taskPacket.scope, "Only analyze lesson1 through lesson5.");
  assert.match(taskPacket.objective, /lesson1至lesson5/);
  assert.ok(
    taskPacket.acceptanceTests.some((item) => item.includes("matches the implementation")),
  );
  assert.ok(
    taskPacket.outOfScope.some((item) => item.includes("lesson6")),
  );
});

test("validateStructuredTaskPacket accepts claw-code shaped packets", () => {
  const result = validateStructuredTaskPacket({
    objective: "Audit task registry behavior",
    scope: "lesson14 task runtime",
    repo: "claw-code",
    branch_policy: "stay on current branch",
    acceptance_tests: ["npm test", "npm run smoke"],
    commit_policy: "do not commit unless asked",
    reporting_contract: "report changed files and verification",
    escalation_policy: "stop if destructive ambiguity appears",
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.packet.branchPolicy, "stay on current branch");
  assert.deepEqual(result.packet.acceptanceTests, ["npm test", "npm run smoke"]);
});

test("Session preserves taskPacket through JSON round-trips", () => {
  const session = new Session();
  session.setTaskPacket({
    objective: "Analyze lesson1 through lesson5",
    scope: "Only analyze lesson1 through lesson5.",
    acceptance: ["Cover each lesson."],
    outOfScope: ["Do not expand to lesson6 or later."],
  });

  const restored = Session.fromJSON(session.toJSON());
  assert.deepEqual(restored.taskPacket, session.taskPacket);
});

test("AgentRuntime does not infer or inject a main-session task pin from user input", async () => {
  let capturedSystemPrompt = null;
  const runtime = new AgentRuntime({
    session: new Session(),
    model: {
      async decide({ systemPrompt }) {
        capturedSystemPrompt = systemPrompt;
        return {
          type: "final",
          finishReason: "stop",
          warnings: [],
          output: "done",
        };
      },
    },
    toolRegistry: new ToolRegistry(),
    systemPrompt: "You are a coding agent.",
    workspaceRoot,
  });

  await runtime.run("逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配", {
    workspaceRoot,
  });

  assert.doesNotMatch(capturedSystemPrompt, /# Task Pin/);
  assert.equal(runtime.session.taskPacket, null);
});

test("compaction summary keeps pinned task objective and scope", () => {
  const session = new Session({
    taskPacket: inferTaskPacketFromPrompt(
      "逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配",
    ),
  });

  session.addUserMessage("逐个分析lesson1至lesson5的功能说明和代码实现,判断是否匹配");
  session.addAssistantMessage("先探索 lesson1 到 lesson5。");
  session.addToolMessage("Agent", { ok: true, content: { status: "completed", lesson: "lesson1" } });
  session.addAssistantMessage("继续探索 lesson2 到 lesson5。");
  session.addToolMessage("Agent", { ok: true, content: { status: "completed", lesson: "lesson2" } });
  session.addAssistantMessage("下一步要做匹配判断。");

  const result = compactSession(session, {
    preserveRecentMessages: 2,
    maxEstimatedTokens: 1,
    autoCompactInputTokensThreshold: 100000,
    autoCompactMinInputTokensDelta: 100000,
    autoCompactRequestBudgetRatio: 0.8,
    summaryMode: "heuristic",
  });

  assert.match(result.formattedSummary, /Task objective:/);
  assert.match(result.formattedSummary, /Task scope:/);
  assert.match(result.formattedSummary, /Only analyze lesson1 through lesson5/);
});
