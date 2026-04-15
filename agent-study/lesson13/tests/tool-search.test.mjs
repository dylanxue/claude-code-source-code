import { test } from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "../src/core/tool-registry.js";
import { bashTool } from "../src/tools/bash.js";
import { editFileTool } from "../src/tools/edit-file.js";
import { globSearchTool } from "../src/tools/glob-search.js";
import { grepSearchTool, grepTextTool } from "../src/tools/grep-text.js";
import { listFilesTool } from "../src/tools/list-files.js";
import { readFileTool } from "../src/tools/read-file.js";
import { skillTool } from "../src/tools/skill.js";
import { createToolSearchTool } from "../src/tools/tool-search.js";
import { webFetchTool } from "../src/tools/web-fetch.js";
import { webSearchTool } from "../src/tools/web-search.js";
import { writeFileTool } from "../src/tools/write-file.js";

function createRealLesson13Registry() {
  const toolRegistry = new ToolRegistry();
  const toolSearchTool = createToolSearchTool(toolRegistry);

  toolRegistry.register(listFilesTool);
  toolRegistry.register(globSearchTool);
  toolRegistry.register(readFileTool);
  toolRegistry.register(grepSearchTool);
  toolRegistry.register(grepTextTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(editFileTool);
  toolRegistry.register(bashTool);
  toolRegistry.register(webFetchTool);
  toolRegistry.register(webSearchTool);
  toolRegistry.register(skillTool);
  toolRegistry.register(toolSearchTool);

  return {
    toolRegistry,
    toolSearchTool,
  };
}

test("ToolSearch returns claw-code style matches for external knowledge tools", async () => {
  const { toolSearchTool } = createRealLesson13Registry();

  const result = await toolSearchTool.execute({
    query: "web search external",
    max_results: 3,
  });

  assert.equal(result.query, "web search external");
  assert.equal(result.normalized_query, "web search external");
  assert.equal(result.matches[0], "WebSearch");
  assert.equal(result.matches.includes("WebFetch"), true);
  assert.equal(result.total_deferred_tools, 12);
  assert.equal(result.pending_mcp_servers, null);
});

test("ToolSearch supports select syntax and canonical tool tokens", async () => {
  const { toolSearchTool } = createRealLesson13Registry();

  const result = await toolSearchTool.execute({
    query: "select:web-search, webfetch, missing",
    max_results: 5,
  });

  assert.deepEqual(result.matches, ["WebSearch", "WebFetch"]);
});

test("ToolSearch works through the real lesson13 registry and finds file-reading tools from descriptions", async () => {
  const { toolRegistry } = createRealLesson13Registry();

  const result = await toolRegistry.execute("ToolSearch", {
    query: "read file content lines",
    max_results: 5,
  });

  assert.equal(result.matches[0], "read_file");
  assert.equal(result.matches.includes("grep_search"), true);
  assert.equal(result.matches.includes("list_files"), true);
  assert.equal(result.total_deferred_tools, 12);
});

test("ToolSearch prefers edit and write tools for file mutation queries in the real lesson13 registry", async () => {
  const { toolRegistry } = createRealLesson13Registry();

  const result = await toolRegistry.execute("ToolSearch", {
    query: "replace text update workspace file",
    max_results: 4,
  });

  assert.equal(result.matches[0], "edit_file");
  assert.equal(result.matches.includes("write_file"), true);
  assert.equal(result.matches.includes("read_file"), true);
  assert.equal(result.matches.slice(0, 3).includes("write_file"), true);
});

test("ToolSearch can narrow by family-style shell queries in the real lesson13 registry", async () => {
  const { toolRegistry } = createRealLesson13Registry();

  const result = await toolRegistry.execute("ToolSearch", {
    query: "+shell command run bash",
    max_results: 3,
  });

  assert.deepEqual(result.matches, ["bash"]);
  assert.equal(result.normalized_query, "shell command run bash");
});
