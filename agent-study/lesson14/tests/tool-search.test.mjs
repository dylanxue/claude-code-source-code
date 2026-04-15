import { test } from "node:test";
import assert from "node:assert/strict";

import { createDefaultToolRegistry } from "../src/bootstrap/register-default-tools.js";

function createRealLesson14Registry() {
  const toolRegistry = createDefaultToolRegistry({
    runSubagent: async () => ({
      agentId: "agent-test",
      name: "agent-test",
      description: "test",
      subagentType: "Explore",
      status: "completed",
      outputFile: "/tmp/output.md",
      manifestFile: "/tmp/manifest.json",
      sessionFile: "/tmp/session.json",
      result: "done",
      error: null,
    }),
  });

  return {
    toolRegistry,
    toolSearchTool: toolRegistry.getTool("ToolSearch"),
  };
}

test("ToolSearch returns claw-code style matches for external knowledge tools", async () => {
  const { toolSearchTool } = createRealLesson14Registry();

  const result = await toolSearchTool.execute({
    query: "web search external",
    max_results: 3,
  });

  assert.equal(result.query, "web search external");
  assert.equal(result.normalized_query, "web search external");
  assert.equal(result.matches[0], "WebSearch");
  assert.equal(result.matches.includes("WebFetch"), true);
  assert.equal(typeof result.total_deferred_tools, "number");
  assert.equal(result.total_deferred_tools >= 20, true);
  assert.equal(result.pending_mcp_servers, null);
});

test("ToolSearch supports select syntax and canonical tool tokens", async () => {
  const { toolSearchTool } = createRealLesson14Registry();

  const result = await toolSearchTool.execute({
    query: "select:web-search, webfetch, missing",
    max_results: 5,
  });

  assert.deepEqual(result.matches, ["WebSearch", "WebFetch"]);
});

test("ToolSearch works through the real lesson14 registry and finds file-reading tools from descriptions", async () => {
  const { toolRegistry } = createRealLesson14Registry();

  const result = await toolRegistry.execute("ToolSearch", {
    query: "read file content lines",
    max_results: 5,
  });

  assert.equal(result.matches[0], "read_file");
  assert.equal(result.matches.includes("grep_search"), true);
  assert.equal(result.matches.includes("list_files"), true);
  assert.equal(typeof result.total_deferred_tools, "number");
  assert.equal(result.total_deferred_tools >= 20, true);
});

test("ToolSearch prefers edit and write tools for file mutation queries in the real lesson14 registry", async () => {
  const { toolRegistry } = createRealLesson14Registry();

  const result = await toolRegistry.execute("ToolSearch", {
    query: "replace text update workspace file",
    max_results: 4,
  });

  assert.equal(result.matches[0], "edit_file");
  assert.equal(result.matches.includes("write_file"), true);
  assert.equal(result.matches.includes("read_file"), true);
  assert.equal(result.matches.slice(0, 3).includes("write_file"), true);
});

test("ToolSearch can narrow by family-style shell queries in the real lesson14 registry", async () => {
  const { toolRegistry } = createRealLesson14Registry();

  const result = await toolRegistry.execute("ToolSearch", {
    query: "+shell command run bash",
    max_results: 3,
  });

  assert.deepEqual(result.matches, ["bash"]);
  assert.equal(result.normalized_query, "shell command run bash");
});

test("ToolSearch can surface Agent for delegation-oriented queries", async () => {
  const { toolRegistry } = createRealLesson14Registry();

  const result = await toolRegistry.execute("ToolSearch", {
    query: "delegate subagent explore plan verification",
    max_results: 4,
  });

  assert.equal(result.matches.includes("Agent"), true);
});
