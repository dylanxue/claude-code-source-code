import test from "node:test";
import assert from "node:assert/strict";

import {
  compactSessionWithStrategy,
  getCompactContinuationMessage,
} from "../src/core/session-compaction.js";
import { Session } from "../src/core/session.js";

const ITERATION_14_LLM_SUMMARY = `<summary>
Task: Analyze lessons 1-5 functionality documentation vs code implementation, delegate to subagents if needed.
Scope: Only lessons 1-5, no expansion to lesson6+.
Acceptance criteria: Cover every lesson, return synthesized answer, judge if documentation matches implementation.
Tools used: read_file, list_files, Agent (Explore subagent type).
Current work: Launched 5 parallel Agent tasks (lesson1-5 analysis), all currently running (status: "running").
Files inspected: README.md for lessons 2-5 (lesson1 was read earlier), directory listings for all 5 lesson src directories.
Key structure found: All lessons have bootstrap/, core/, index.js, model/, tools/ directories; lessons 3-5 also have config/, logging/ directories.
Lesson-specific features to verify: lesson2 (inputSchema, grep_text, write_file, bash tools, tool failure handling), lesson3 (OpenAIResponsesModel, createModel, .env.local, toolCallId), lesson4 (session persistence, multi-protocol adapters), lesson5 (session compaction, summary continuation).
Errors: None encountered.
Unresolved: Awaiting subagent results for final synthesized answer.
</summary>`;

const ITERATION_26_LLM_SUMMARY = `<summary>
Task: Analyze lessons 1-5 functionality documentation vs code implementation, delegate to subagents if needed.
Scope: Only lessons 1-5, no expansion to lesson6+.
Acceptance criteria: Cover every lesson, return synthesized answer, judge if documentation matches implementation.
Tools used: read_file, list_files, Agent (Explore subagent type), TaskList, TaskOutput.
Current work: 5 parallel Agent tasks launched; lesson1 analysis COMPLETED (matches), lessons 2-5 still running.
Files inspected: README.md for lessons 1-2; src/core files (index.js, tool-registry.js, agent-runtime.js, session.js) for lesson1.
Key findings:
- Lesson1: 功能说明与代码实现完全匹配 (命令行入口、会话消息存储、工具注册执行、mock planner、agent loop)
- Directory structure matches README exactly
- TaskOutput error: task-1776214330277-3e2a0a94 not found (attempted before task existed)
- Lesson2 README shows new features: inputSchema, grep_text, write_file, bash tools, tool failure handling, multi-step planner
Errors: Task lookup for task-1776214330277-3e2a0a94 returned "task not found"
Unresolved: Awaiting subagent results for lessons 2-5 to provide final synthesized comparison answer.
</summary>`;

function buildCompactedSession(existingSummary) {
  const session = new Session({
    messages: [
      {
        role: "system",
        content: getCompactContinuationMessage(existingSummary, true),
        createdAt: new Date().toISOString(),
      },
    ],
  });

  session.addAssistantMessage("lesson5 子任务已启动。");
  session.addToolMessage("TaskList", { ok: true, content: { total: 5, completed: 1, running: 4 } });
  session.addToolMessage("TaskOutput", {
    ok: false,
    error: "task not found",
  });
  session.addAssistantMessage("我先补读 lesson1 和 lesson2 的 README。");

  return session;
}

test("compaction merge preserves non-empty llm summaries across multiple rounds", async () => {
  const session = buildCompactedSession(ITERATION_14_LLM_SUMMARY);

  const result = await compactSessionWithStrategy(
    session,
    {
      preserveRecentMessages: 2,
      maxEstimatedTokens: 1,
      autoCompactInputTokensThreshold: 100000,
      autoCompactMinInputTokensDelta: 100000,
      autoCompactRequestBudgetRatio: 0.8,
      summaryMode: "auto",
    },
    {
      model: {
        async decide() {
          return {
            type: "final",
            output: ITERATION_26_LLM_SUMMARY,
          };
        },
      },
      iteration: 26,
    },
  );

  assert.notEqual(result.formattedSummary.trim(), "Conversation summary:");
  assert.match(result.formattedSummary, /Task objective: Analyze lessons 1-5/);
  assert.match(result.formattedSummary, /Task scope: Only lessons 1-5/);
  assert.match(result.formattedSummary, /Tools mentioned: read_file, list_files, Agent/);
  assert.match(result.formattedSummary, /Current work: 5 parallel Agent tasks launched/);
  assert.match(result.formattedSummary, /Key findings:/);
});

test("compaction merge keeps generic note lines when summaries do not follow bullet schema", async () => {
  const session = buildCompactedSession("<summary>\nAlpha state note\n</summary>");

  const result = await compactSessionWithStrategy(
    session,
    {
      preserveRecentMessages: 2,
      maxEstimatedTokens: 1,
      autoCompactInputTokensThreshold: 100000,
      autoCompactMinInputTokensDelta: 100000,
      autoCompactRequestBudgetRatio: 0.8,
      summaryMode: "auto",
    },
    {
      model: {
        async decide() {
          return {
            type: "final",
            output: "<summary>\nBeta follow-up note\n</summary>",
          };
        },
      },
      iteration: 2,
    },
  );

  assert.match(result.formattedSummary, /Alpha state note/);
  assert.match(result.formattedSummary, /Beta follow-up note/);
  assert.notEqual(result.formattedSummary.trim(), "Conversation summary:");
});
