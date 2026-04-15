import test from "node:test";
import assert from "node:assert/strict";

import { buildAppSystemPrompt } from "../src/bootstrap/system-prompt.js";

test("buildAppSystemPrompt uses claw-code-style sections while preserving lesson14 tool guidance", () => {
  const prompt = buildAppSystemPrompt({
    workspaceRoot: "/tmp/lesson14-workspace",
    resumePath: null,
  });

  assert.match(prompt, /^You are an interactive coding agent/u);
  assert.match(prompt, /# System/);
  assert.match(prompt, /# Doing Tasks/);
  assert.match(prompt, /# Using Tools/);
  assert.match(prompt, /# Environment Context/);
  assert.match(prompt, /ToolSearch before guessing tool names/);
  assert.match(prompt, /consider Agent with a bounded subagent type/);
  assert.match(prompt, /WorkerCreate, WorkerAwaitReady, and WorkerSendPrompt/);
});

test("buildAppSystemPrompt adds resume guidance for resumed sessions", () => {
  const prompt = buildAppSystemPrompt({
    workspaceRoot: "/tmp/lesson14-workspace",
    resumePath: "/tmp/session.json",
  });

  assert.match(prompt, /# Resume Guidance/);
  assert.match(prompt, /Treat the saved session history as the primary source of truth/);
  assert.match(prompt, /Session mode: resume/);
});
