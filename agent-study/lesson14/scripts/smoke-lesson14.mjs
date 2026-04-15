import { createServer } from "node:http";
import process from "node:process";
import { mkdir, readFile as readFileFromDisk, rm, writeFile as writeFileToDisk } from "node:fs/promises";
import path from "node:path";

import { createDefaultToolRegistry } from "../src/bootstrap/register-default-tools.js";
import { AgentRuntime } from "../src/core/agent-runtime.js";
import { createBackgroundSubagentRunner } from "../src/core/subagent-runner.js";
import { createBackgroundWorkerControl } from "../src/core/worker-control.js";
import { buildPreToolUseBlockResult } from "../src/core/pre-tool-use-hooks.js";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { bashTool } from "../src/tools/bash.js";
import { editFileTool } from "../src/tools/edit-file.js";
import { globSearchTool } from "../src/tools/glob-search.js";
import { grepSearchTool, grepTextTool } from "../src/tools/grep-text.js";
import { listFilesTool } from "../src/tools/list-files.js";
import { readFileTool } from "../src/tools/read-file.js";
import { skillTool } from "../src/tools/skill.js";
import { webFetchTool } from "../src/tools/web-fetch.js";
import { webSearchTool } from "../src/tools/web-search.js";
import { writeFileTool } from "../src/tools/write-file.js";

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function waitForTaskTerminalStatus(toolRegistry, workspaceRoot, taskId, timeoutMs = 1500) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const task = await toolRegistry.execute(
      "TaskGet",
      { task_id: taskId },
      { workspaceRoot },
    );

    if (["completed", "failed", "stopped", "cancelled"].includes(task.status)) {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for task ${taskId} to reach a terminal status`);
}

async function waitForWorkerTerminalStatus(toolRegistry, workspaceRoot, workerId, timeoutMs = 1500) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const worker = await toolRegistry.execute(
      "WorkerGet",
      { worker_id: workerId },
      { workspaceRoot },
    );

    if (["finished", "failed"].includes(worker.status)) {
      return worker;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for worker ${workerId} to reach a terminal status`);
}

async function startLocalWebFixtureServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    if (url.pathname === "/page") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        [
          "<html><head><title>Lesson 14 Fixture</title></head><body>",
          "<h1>Lesson 14 Fixture</h1>",
          "<p>WebFetch should convert HTML into readable text.</p>",
          "<p>WebSearch should discover this page as an external knowledge source.</p>",
          "</body></html>",
        ].join(""),
      );
      return;
    }

    if (url.pathname === "/search") {
      const port = server.address()?.port;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        [
          "<html><body>",
          `<a class="result__a" href="/l/?uddg=${encodeURIComponent(`http://127.0.0.1:${port}/page`)}">Lesson 14 Fixture</a>`,
          '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fblocked.example.com%2Fsecret">Blocked Result</a>',
          "</body></html>",
        ].join(""),
      );
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function run() {
  const workspaceRoot = process.cwd();
  function lastToolMessage(messages) {
    return [...messages].reverse().find((message) => message.role === "tool");
  }

  function createDelegatedModel({ subagentType } = {}) {
    return {
      async decide({ messages }) {
        const lastTool = lastToolMessage(messages);

        if (subagentType === "Plan") {
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
                        content: "Inspect current behavior",
                        activeForm: "Inspecting current behavior",
                        status: "completed",
                      },
                      {
                        content: "Draft the next plan",
                        activeForm: "Drafting the next plan",
                        status: "in_progress",
                      },
                    ],
                  },
                  toolCallId: "plan-todos",
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
                    steps: [
                      "Inspect the current behavior",
                      "Make the smallest safe change",
                      "Run focused validation",
                    ],
                    risk: "Edge-case coverage may still be thin.",
                  },
                  toolCallId: "plan-structure",
                },
              ],
            };
          }

          const payload = lastTool.content.content;
          return {
            type: "final",
            finishReason: "stop",
            warnings: [],
            output: `Plan summary: ${payload.structured_output.steps.length} steps`,
          };
        }

        if (!lastTool) {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [
              {
                toolName: "read_file",
                input: { path: "README.md" },
                toolCallId: "agent-readme",
              },
            ],
          };
        }

        const payload = lastTool.content.content;
        return {
          type: "final",
          finishReason: "stop",
          warnings: [],
          output: `Delegated summary: ${payload.file.content.split("\n")[0]}`,
        };
      },
    };
  }

  const runSubagent = createBackgroundSubagentRunner({
    createModel: createDelegatedModel,
  });

  const toolRegistry = createDefaultToolRegistry({
    runSubagent,
    workerControl: createBackgroundWorkerControl({
      createModel: createDelegatedModel,
      bootDelayMs: 5,
    }),
  });

  process.env.LIST_FILES_MAX_ENTRIES = "3";
  process.env.GREP_TEXT_MAX_MATCHES = "10";
  process.env.BASH_MAX_OUTPUT_CHARS = "120";
  process.env.WRITE_FILE_MAX_BYTES = "1000000";
  process.env.READ_FILE_MAX_BYTES = "1000000";
  process.env.READ_FILE_MAX_WINDOW_LINES = "20";

  const tempRoot = path.join(workspaceRoot, ".tmp-smoke");
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  await writeFileToDisk(
    path.join(tempRoot, "README.md"),
    "# Lesson 14 Smoke Fixture\nDelegated summary content.\n",
    "utf8",
  );
  const webFixture = await startLocalWebFixtureServer();
  process.env.CLAWD_WEB_SEARCH_BASE_URL = `${webFixture.baseUrl}/search`;
  process.env.WEB_FETCH_TIMEOUT_MS = "2000";
  process.env.WEB_SEARCH_TIMEOUT_MS = "2000";

  try {
  const read = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 5, limit: 12 },
    { workspaceRoot },
  );
  assert(read.type === "text", "read_file should return a text envelope", read);
  assert(typeof read.file.startLine === "number", "read_file should report startLine", read);
  assert(typeof read.file.numLines === "number", "read_file should report numLines", read);
  assert(typeof read.file.totalLines === "number", "read_file should report totalLines", read);
  assert(read.file.startLine === 6, "read_file should honor offset as a zero-based start line", read);
  assert(read.file.numLines === 12, "read_file should honor limit", read);
  assert(typeof read.file.content === "string", "read_file should return line-window content", read);

  const readDefaultWindow = await readFileTool.execute(
    { path: "src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(readDefaultWindow.type === "text", "read_file should return a text envelope for bare reads", readDefaultWindow);
  assert(readDefaultWindow.file.startLine === 1, "read_file bare reads should start at line 1", readDefaultWindow);
  assert(readDefaultWindow.file.numLines === 20, "read_file should use READ_FILE_MAX_WINDOW_LINES for bare reads", readDefaultWindow);

  const readOffsetOnly = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 10 },
    { workspaceRoot },
  );
  assert(readOffsetOnly.type === "text", "read_file should return a text envelope for offset-only reads", readOffsetOnly);
  assert(readOffsetOnly.file.numLines === 20, "read_file should use READ_FILE_MAX_WINDOW_LINES as the default window size", readOffsetOnly);

  const clampedWindowRead = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 0, limit: 9999 },
    { workspaceRoot },
  );
  assert(clampedWindowRead.type === "text", "read_file should still return a text envelope for oversized limits", clampedWindowRead);
  assert(clampedWindowRead.file.numLines === 20, "read_file should apply READ_FILE_MAX_WINDOW_LINES", clampedWindowRead);

  const grep = await grepSearchTool.execute(
    { pattern: "read_file", path: "src", output_mode: "files_with_matches" },
    { workspaceRoot },
  );
  assert(Array.isArray(grep.filenames), "grep_search should return filenames", grep);
  assert(grep.numFiles >= 1, "grep_search should report numFiles", grep);
  assert(grep.mode === "files_with_matches", "grep_search should report mode", grep);

  const grepTextAlias = await grepTextTool.execute(
    { pattern: "read_file", path: "src", output_mode: "files_with_matches" },
    { workspaceRoot },
  );
  assert(grepTextAlias.mode === "files_with_matches", "grep_text alias should report mode", grepTextAlias);
  assert(grepTextAlias.numFiles >= 1, "grep_text alias should report numFiles", grepTextAlias);

  const grepSingleFile = await grepSearchTool.execute(
    { pattern: "preToolUse", path: "src/core/agent-runtime.js" },
    { workspaceRoot },
  );
  assert(grepSingleFile.numFiles === 1, "grep_search should accept a single file path", grepSingleFile);
  assert(grepSingleFile.filenames[0].endsWith("src/core/agent-runtime.js"), "grep_search should find matches inside a single file path", grepSingleFile);

  const grepRegex = await grepSearchTool.execute(
    {
      pattern: "read_file|grep_search",
      path: "src/tools",
      regex: true,
      output_mode: "matches",
      glob: "*.js",
      file_type: "js",
      head_limit: 3,
      offset: 1,
    },
    { workspaceRoot },
  );
  assert(grepRegex.mode === "files_with_matches", "grep_search should report files_with_matches mode", grepRegex);
  assert(grepRegex.appliedLimit === 3 || grepRegex.appliedLimit === null, "grep_search should report appliedLimit like grep_search", grepRegex);
  assert(grepRegex.appliedOffset === 1, "grep_search should report appliedOffset", grepRegex);
  assert(grepRegex.numFiles <= 3, "grep_search should honor head_limit", grepRegex);

  const grepContent = await grepSearchTool.execute(
    {
      pattern: "read_file",
      path: "src/tools/read-file.js",
      output_mode: "content",
      context: 1,
      head_limit: 4,
    },
    { workspaceRoot },
  );
  assert(typeof grepContent.content === "string", "grep_search content mode should return content text", grepContent);
  assert(grepContent.numLines >= 1, "grep_search content mode should report numLines", grepContent);
  assert(grepContent.filenames[0].endsWith("src/tools/read-file.js"), "grep_search content mode should return filenames", grepContent);

  const grepFlagAliases = await grepSearchTool.execute(
    {
      pattern: "READ_FILE",
      path: "src/tools",
      output_mode: "content",
      "-C": 1,
      "-n": true,
      "-i": true,
      type: "js",
      head_limit: 5,
    },
    { workspaceRoot },
  );
  assert(grepFlagAliases.mode === "content", "grep_search should support claw-code style content flag aliases", grepFlagAliases);
  assert(grepFlagAliases.numFiles >= 1, "grep_search should support type alias filtering", grepFlagAliases);
  assert(typeof grepFlagAliases.content === "string" && grepFlagAliases.content.includes(":"),
    "grep_search should support -n line number prefixes",
    grepFlagAliases,
  );

  const list = await listFilesTool.execute(
    { path: "src/tools" },
    { workspaceRoot },
  );
  assert(list.truncated === true, "list_files should truncate under LIST_FILES_MAX_ENTRIES=3", list);
  assert(list.returnedEntryCount === 3, "list_files should return 3 entries under limit", list);
  assert(list.omittedEntryCount > 0, "list_files should report omitted entries when truncated", list);

  let listFilesBoundaryError = null;
  try {
    await listFilesTool.execute(
      { path: "../" },
      { workspaceRoot },
    );
  } catch (error) {
    listFilesBoundaryError = error;
  }
  assert(
    /Path escapes workspace boundary/.test(String(listFilesBoundaryError?.message ?? "")),
    "list_files should reject paths that escape the workspace boundary",
    listFilesBoundaryError,
  );

  const glob = await globSearchTool.execute(
    { pattern: "*.js", path: "src/tools" },
    { workspaceRoot },
  );
  assert(Array.isArray(glob.filenames), "glob_search should return filenames", glob);
  assert(glob.numFiles >= 1, "glob_search should find JavaScript files", glob);
  assert(typeof glob.durationMs === "number", "glob_search should report durationMs", glob);

  const bash = await bashTool.execute(
    { command: 'printf "1\\n2\\n3\\n4\\n5\\n6\\n7\\n"' },
    { workspaceRoot },
  );
  assert(bash.interrupted === false, "bash should report uninterrupted success", bash);
  assert(bash.returnCodeInterpretation === null, "bash should not report an exit code for success", bash);
  assert(typeof bash.stdout === "string" && bash.stdout.length > 0, "bash should return stdout text", bash);
  assert(bash.sandboxStatus?.requested?.filesystem_mode === "workspace-only", "bash should report default sandbox filesystem mode", bash);

  const bashTimeout = await bashTool.execute(
    { command: 'node -e "setTimeout(() => console.log(\'late\'), 500)"', timeout: 50 },
    { workspaceRoot },
  );
  assert(bashTimeout.interrupted === true, "bash should report interrupted for timed-out commands", bashTimeout);
  assert(bashTimeout.returnCodeInterpretation === "timeout", "bash should report timeout", bashTimeout);
  assert(
    bashTimeout.stderr.includes("Command exceeded timeout"),
    "bash should include the timeout message in stderr",
    bashTimeout,
  );

  const bashBackground = await bashTool.execute(
    {
      command: 'node -e "setTimeout(() => {}, 200)"',
      run_in_background: true,
    },
    { workspaceRoot },
  );
  assert(
    typeof bashBackground.backgroundTaskId === "string",
    "bash background launch should report backgroundTaskId",
    bashBackground,
  );
  assert(bashBackground.noOutputExpected === true, "bash background launch should report noOutputExpected", bashBackground);

  const bashSandboxDisabled = await bashTool.execute(
    {
      command: 'printf "sandbox off"',
      dangerouslyDisableSandbox: true,
      namespaceRestrictions: false,
      filesystemMode: "allow-list",
      allowedMounts: ["src"],
    },
    { workspaceRoot },
  );
  assert(
    bashSandboxDisabled.sandboxStatus.enabled === false,
    "bash should report disabled sandbox status when requested",
    bashSandboxDisabled,
  );
  assert(
    bashSandboxDisabled.sandboxStatus.allowed_mounts[0] === path.join(workspaceRoot, "src"),
    "bash should normalize allow-list mounts relative to the workspace root",
    bashSandboxDisabled,
  );

  const webFetch = await webFetchTool.execute(
    {
      url: `${webFixture.baseUrl}/page`,
      prompt: "Extract the title from this page.",
    },
    { workspaceRoot },
  );
  assert(webFetch.code === 200, "WebFetch should return the response status code", webFetch);
  assert(/Lesson 14 Fixture/.test(webFetch.result), "WebFetch should summarize the fetched page", webFetch);
  assert(webFetch.url === `${webFixture.baseUrl}/page`, "WebFetch should report the fetched URL", webFetch);

  const webSearch = await webSearchTool.execute(
    {
      query: "lesson14 fixture",
      blocked_domains: ["blocked.example.com"],
    },
    { workspaceRoot },
  );
  const webSearchHits = webSearch.results?.[1]?.content ?? [];
  assert(webSearch.query === "lesson14 fixture", "WebSearch should echo the query", webSearch);
  assert(Array.isArray(webSearchHits), "WebSearch should return a structured hit list", webSearch);
  assert(webSearchHits.length === 1, "WebSearch should filter blocked domains", webSearch);
  assert(webSearchHits[0].url === `${webFixture.baseUrl}/page`, "WebSearch should decode redirect URLs", webSearch);

  const toolSearch = await toolRegistry.execute(
    "ToolSearch",
    {
      query: "web external search fetch",
      max_results: 4,
    },
    { workspaceRoot },
  );
  assert(Array.isArray(toolSearch.matches), "ToolSearch should return matches", toolSearch);
  assert(toolSearch.matches.includes("WebSearch"), "ToolSearch should find WebSearch", toolSearch);
  assert(toolSearch.matches.includes("WebFetch"), "ToolSearch should find WebFetch", toolSearch);
  assert(toolSearch.total_deferred_tools >= 4, "ToolSearch should report searchable tool count", toolSearch);

  const delegationSearch = await toolRegistry.execute(
    "ToolSearch",
    {
      query: "delegate subagent explore plan verification",
      max_results: 4,
    },
    { workspaceRoot },
  );
  assert(delegationSearch.matches.includes("Agent"), "ToolSearch should discover Agent in lesson14", delegationSearch);

  const planningSearch = await toolRegistry.execute(
    "ToolSearch",
    {
      query: "todo structured plan output",
      max_results: 5,
    },
    { workspaceRoot },
  );
  assert(planningSearch.matches.includes("TodoWrite"), "ToolSearch should discover TodoWrite in lesson14", planningSearch);
  assert(planningSearch.matches.includes("StructuredOutput"), "ToolSearch should discover StructuredOutput in lesson14", planningSearch);

  const skillFixturePath = path.join(tempRoot, ".codex", "skills", "review", "SKILL.md");
  await mkdir(path.dirname(skillFixturePath), { recursive: true });
  await writeFileToDisk(
    skillFixturePath,
    [
      "---",
      "name: review",
      "---",
      "description: Review code changes carefully.",
      "# Review",
      "Check correctness before style.",
    ].join("\n"),
    "utf8",
  );
  const skill = await skillTool.execute(
    {
      skill: "review",
      args: "src/index.js",
    },
    { workspaceRoot: tempRoot },
  );
  assert(skill.skill === "review", "Skill should echo the requested skill name", skill);
  assert(skill.path === skillFixturePath, "Skill should resolve project-local skills", skill);
  assert(skill.description === "Review code changes carefully.", "Skill should parse description", skill);

  const delegated = await toolRegistry.execute(
    "Agent",
    {
      description: "Explore the smoke README",
      prompt: "Read README.md and summarize the heading.",
      subagent_type: "explorer",
      name: "Smoke Explore",
    },
    { workspaceRoot: tempRoot },
  );
  assert(delegated.status === "running", "Agent should return a running manifest immediately", delegated);
  assert(delegated.subagentType === "Explore", "Agent should normalize subagent_type aliases", delegated);
  const delegatedCompletedTask = await waitForTaskTerminalStatus(toolRegistry, tempRoot, delegated.taskId);
  const delegatedCompletedManifest = JSON.parse(await readFileFromDisk(delegated.manifestFile, "utf8"));
  assert(delegatedCompletedTask.status === "completed", "Explore delegated task should finish in the background", delegatedCompletedTask);
  assert(
    typeof delegatedCompletedManifest.result === "string" &&
      delegatedCompletedManifest.result.includes("Lesson 14 Smoke Fixture"),
    "Agent manifest should surface the delegated final result after completion",
    delegatedCompletedManifest,
  );

  const delegatedPlan = await toolRegistry.execute(
    "Agent",
    {
      description: "Plan the next work",
      prompt: "Create a small plan and persist current todos.",
      subagent_type: "Plan",
      name: "Smoke Plan",
    },
    { workspaceRoot: tempRoot },
  );
  assert(delegatedPlan.status === "running", "Plan Agent should also return a running manifest immediately", delegatedPlan);
  assert(delegatedPlan.subagentType === "Plan", "Plan Agent should preserve its subagent type", delegatedPlan);
  const delegatedPlanTask = await waitForTaskTerminalStatus(toolRegistry, tempRoot, delegatedPlan.taskId);
  const delegatedPlanManifest = JSON.parse(await readFileFromDisk(delegatedPlan.manifestFile, "utf8"));
  assert(delegatedPlanTask.status === "completed", "Plan delegated task should finish in the background", delegatedPlanTask);
  assert(
    typeof delegatedPlanManifest.result === "string" &&
      delegatedPlanManifest.result.includes("Plan summary: 3 steps"),
    "Plan Agent should use StructuredOutput to build a short plan summary",
    delegatedPlanManifest,
  );

  const workerCreated = await toolRegistry.execute(
    "WorkerCreate",
    {
      description: "Explore README through worker handshake",
      prompt: "Read README.md and summarize the heading.",
      subagent_type: "explorer",
      name: "Smoke Worker",
    },
    { workspaceRoot: tempRoot },
  );
  assert(workerCreated.status === "spawning", "WorkerCreate should begin in spawning state", workerCreated);

  const workerReady = await toolRegistry.execute(
    "WorkerAwaitReady",
    {
      worker_id: workerCreated.worker_id,
      timeout_ms: 500,
      poll_interval_ms: 10,
    },
    { workspaceRoot: tempRoot },
  );
  assert(workerReady.status === "ready_for_prompt", "WorkerAwaitReady should reach ready_for_prompt", workerReady);
  assert(workerReady.ready === true, "WorkerAwaitReady should report readiness", workerReady);

  const workerRunning = await toolRegistry.execute(
    "WorkerSendPrompt",
    {
      worker_id: workerCreated.worker_id,
    },
    { workspaceRoot: tempRoot },
  );
  assert(workerRunning.status === "running", "WorkerSendPrompt should transition the worker to running", workerRunning);
  assert(typeof workerRunning.task_id === "string", "WorkerSendPrompt should attach a task id once dispatched", workerRunning);

  const workerFinished = await waitForWorkerTerminalStatus(toolRegistry, tempRoot, workerCreated.worker_id);
  assert(workerFinished.status === "finished", "Worker should reach finished after delegated execution", workerFinished);
  assert(
    typeof workerFinished.result === "string" &&
      workerFinished.result.includes("Lesson 14 Smoke Fixture"),
    "Worker should surface the delegated result after completion",
    workerFinished,
  );

  const taskList = await toolRegistry.execute(
    "TaskList",
    {},
    { workspaceRoot: tempRoot },
  );
  assert(taskList.count >= 2, "TaskList should report delegated tasks", taskList);

  const createdPromptTask = await toolRegistry.execute(
    "TaskCreate",
    {
      prompt: "Investigate smoke-task parity",
      description: "background smoke task",
    },
    { workspaceRoot: tempRoot },
  );
  assert(createdPromptTask.status === "created", "TaskCreate should create a created task", createdPromptTask);

  const createdPacketTask = await toolRegistry.execute(
    "RunTaskPacket",
    {
      objective: "Audit smoke task packet flow",
      scope: "lesson14 smoke registry path",
      repo: "claw-code",
      branch_policy: "stay on current branch",
      acceptance_tests: ["npm test", "npm run smoke"],
      commit_policy: "do not commit unless asked",
      reporting_contract: "report created task ids and verification",
      escalation_policy: "stop on destructive ambiguity",
    },
    { workspaceRoot: tempRoot },
  );
  assert(createdPacketTask.status === "created", "RunTaskPacket should create a created task", createdPacketTask);

  const delegatedTask = await toolRegistry.execute(
    "TaskGet",
    { task_id: delegated.taskId },
    { workspaceRoot: tempRoot },
  );
  assert(delegatedTask.task_id === delegated.taskId, "TaskGet should fetch the delegated task by id", delegatedTask);
  assert(delegatedTask.status === "completed", "TaskGet should reflect delegated completion", delegatedTask);

  const delegatedTaskOutput = await toolRegistry.execute(
    "TaskOutput",
    { task_id: delegated.taskId },
    { workspaceRoot: tempRoot },
  );
  assert(
    typeof delegatedTaskOutput.output === "string" && delegatedTaskOutput.output.includes("Lesson 14 Smoke Fixture"),
    "TaskOutput should surface the delegated task output",
    delegatedTaskOutput,
  );
  assert(delegatedTaskOutput.has_output === true, "TaskOutput should report has_output", delegatedTaskOutput);

  const writeFixtureRelativePath = path.join(".tmp-smoke", "write-file.txt");
  const writeCreate = await writeFileTool.execute(
    {
      path: writeFixtureRelativePath,
      content: "alpha\nbeta\n",
    },
    { workspaceRoot },
  );
  assert(writeCreate.type === "create", "write_file should report create for new files", writeCreate);
  assert(writeCreate.originalFile === null, "write_file should expose null originalFile for creates", writeCreate);

  const writeUpdate = await writeFileTool.execute(
    {
      path: writeFixtureRelativePath,
      content: "omega\n",
    },
    { workspaceRoot },
  );
  assert(writeUpdate.type === "update", "write_file should report update for existing files", writeUpdate);
  assert(writeUpdate.originalFile === "alpha\nbeta\n", "write_file should preserve originalFile on update", writeUpdate);
  assert(writeUpdate.structuredPatch[0]?.oldLines === 2, "write_file structuredPatch should use rust-style line counts", writeUpdate);
  assert(writeUpdate.structuredPatch[0]?.newLines === 1, "write_file structuredPatch should report updated line counts", writeUpdate);

  const editFixtureRelativePath = path.join(".tmp-smoke", "edit-file.txt");
  await writeFileToDisk(path.join(workspaceRoot, editFixtureRelativePath), "alpha beta alpha\n", "utf8");
  const editOnce = await editFileTool.execute(
    {
      path: editFixtureRelativePath,
      old_string: "alpha",
      new_string: "omega",
    },
    { workspaceRoot },
  );
  assert(editOnce.replaceAll === false, "edit_file should default to single replacement", editOnce);

  const editAll = await editFileTool.execute(
    {
      path: editFixtureRelativePath,
      old_string: "alpha",
      new_string: "sigma",
      replace_all: true,
    },
    { workspaceRoot },
  );
  const editedContent = await readFileFromDisk(path.join(workspaceRoot, editFixtureRelativePath), "utf8");
  assert(editAll.replaceAll === true, "edit_file should support replace_all", editAll);
  assert(editedContent === "omega beta sigma\n", "edit_file should persist edited content", { editedContent, editAll });

  process.env.READ_FILE_MAX_BYTES = "100";
  const oversizedRead = await readFileTool.execute(
    { path: "src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(oversizedRead.reason === "file_too_large", "read_file should report file_too_large", oversizedRead);
  assert(
    oversizedRead.enforcement?.kind === "block_direct_file_dump_follow_up",
    "read_file should expose enforcement metadata for direct file dumps",
    oversizedRead,
  );
  const oversizedWindowRead = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 10, limit: 8 },
    { workspaceRoot },
  );
  assert(
    oversizedWindowRead.reason === "file_too_large",
    "read_file should apply the same file-size cap to full reads and window reads",
    oversizedWindowRead,
  );

  const guardedBash = await bashTool.execute(
    { command: "cat src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(
    guardedBash.guard?.reason === "file_too_large_for_direct_shell_dump",
    "bash should guard direct large file dumps",
    guardedBash,
  );

  assert(toolRegistry.getToolMetadata("read_file")?.family === "file_read", "tool registry should expose tool family metadata");
  assert(toolRegistry.getToolMetadata("grep_search")?.family === "search", "tool registry should expose grep_search family metadata");
  assert(toolRegistry.getToolMetadata("grep_text")?.family === "search", "tool registry should expose search family metadata");
  assert(toolRegistry.getToolMetadata("list_files")?.family === "file_discovery", "tool registry should expose discovery family metadata");
  assert(toolRegistry.getToolMetadata("glob_search")?.family === "file_discovery", "tool registry should expose glob search family metadata");
  assert(toolRegistry.getToolMetadata("write_file")?.family === "file_write", "tool registry should expose write tool family metadata");
  assert(toolRegistry.getToolMetadata("edit_file")?.family === "file_edit", "tool registry should expose edit tool family metadata");
  assert(toolRegistry.getToolMetadata("bash")?.family === "shell", "tool registry should expose shell family metadata");
  const runtime = new AgentRuntime({
    session: new Session(),
    model: {},
    toolRegistry,
    systemPrompt: "test",
    workspaceRoot,
  });
  runtime.pendingGuardrails = [
    {
      sourceIteration: 1,
      sourceToolName: "read_file",
      sourceToolFamily: "file_read",
      sourceInput: { path: "src/tools/grep-text.js" },
      kind: "block_direct_file_dump_follow_up",
      path: "src/tools/grep-text.js",
      sourceTool: "read_file",
    },
  ];

  const blockedToolCall = runtime.findBlockedToolCall({
    toolName: "bash",
    input: { command: "cat src/tools/grep-text.js" },
  });
  assert(
    blockedToolCall?.guardrail?.kind === "block_direct_file_dump_follow_up",
    "runtime should detect blockable direct file dump guardrails",
    blockedToolCall,
  );
  const blockedResult = buildPreToolUseBlockResult(
    { toolName: "bash", input: { command: "cat src/tools/grep-text.js" } },
    blockedToolCall,
  );
  assert(blockedResult.blocked === true, "runtime should build structured blocked tool results", blockedResult);
  assert(
    blockedResult.reason === "pre_tool_use_blocked",
    "runtime should mark blocked tool results with pre_tool_use_blocked reason",
    blockedResult,
  );

  const blockedWorkspaceEscape = runtime.findBlockedToolCall({
    toolName: "bash",
    input: { command: "ls ../" },
  });
  assert(
    blockedWorkspaceEscape?.guardrail?.kind === "block_workspace_escape_path_access",
    "runtime should block obvious bash probes that escape the workspace boundary",
    blockedWorkspaceEscape,
  );

  const runtimeDecisionEvents = [];
  let runtimeDecisionCalls = 0;
  const decisionRuntime = new AgentRuntime({
    session: new Session(),
    model: {
      async decide() {
        runtimeDecisionCalls += 1;
        if (runtimeDecisionCalls === 1) {
          return {
            type: "tools",
            finishReason: "tool_calls",
            warnings: [],
            toolCalls: [{ toolName: "list_files", input: { path: "src" }, toolCallId: "tool-1" }],
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
      runtimeDecisionEvents.push(event);
    },
  });
  const decisionRun = await decisionRuntime.run("列出 src 然后结束", { workspaceRoot });
  assert(Array.isArray(decisionRun.decisionJournal), "runtime should return a decision journal in lesson13", decisionRun);
  assert(decisionRun.decisionJournal.length === 3, "runtime should record tools -> tool_results -> final in the decision journal", decisionRun.decisionJournal);
  assert(decisionRun.decisionJournal[0].decisionType === "tools", "decision journal should record the tools decision", decisionRun.decisionJournal[0]);
  assert(decisionRun.decisionJournal[1].kind === "tool_results", "decision journal should record tool result summaries", decisionRun.decisionJournal[1]);
  assert(decisionRun.decisionJournal[2].decisionType === "final", "decision journal should record the final decision", decisionRun.decisionJournal[2]);
  assert(
    runtimeDecisionEvents.filter((event) => event.channel === "runtime_decision").length === 3,
    "runtime should emit runtime_decision events for each decision journal entry",
    runtimeDecisionEvents,
  );

  const guardedHead = await bashTool.execute(
    { command: "head -n 20 src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(
    guardedHead.guard?.reason === "file_too_large_for_direct_shell_dump",
    "bash should guard head-based large file dumps",
    guardedHead,
  );

  const guardedHeadNumeric = await bashTool.execute(
    { command: "head -50 src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(
    guardedHeadNumeric.guard?.reason === "file_too_large_for_direct_shell_dump",
    "bash should guard numeric head-based large file dumps",
    guardedHeadNumeric,
  );

  const guardedTailPipe = await bashTool.execute(
    { command: "tail -n +51 src/tools/grep-text.js | head -60" },
    { workspaceRoot },
  );
  assert(
    guardedTailPipe.guard?.reason === "file_too_large_for_direct_shell_dump",
    "bash should guard tail/head pipeline file dumps",
    guardedTailPipe,
  );

  const guardedWcThenHead = await bashTool.execute(
    { command: "wc -l src/tools/grep-text.js && head -50 src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(
    guardedWcThenHead.guard?.reason === "file_too_large_for_direct_shell_dump",
    "bash should guard wc/head compound file dumps",
    guardedWcThenHead,
  );

  const guardedNodeRead = await bashTool.execute(
    {
      command:
        'node -e "console.log(require(\'fs\').readFileSync(\'src/tools/grep-text.js\', \'utf8\'))"',
    },
    { workspaceRoot },
  );
  assert(
    guardedNodeRead.guard?.reason === "file_too_large_for_direct_shell_dump",
    "bash should guard node readFileSync file dumps",
    guardedNodeRead,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: {
          read_file: {
            type: read.type,
            startLine: read.file.startLine,
            numLines: read.file.numLines,
            totalLines: read.file.totalLines,
          },
          read_file_default_window: {
            startLine: readDefaultWindow.file.startLine,
            numLines: readDefaultWindow.file.numLines,
          },
          read_file_offset_only: {
            startLine: readOffsetOnly.file.startLine,
            numLines: readOffsetOnly.file.numLines,
          },
          grep_text: {
            mode: grep.mode,
            numFiles: grep.numFiles,
            filenames: grep.filenames.slice(0, 3),
          },
          grep_search: {
            mode: grep.mode,
            numFiles: grep.numFiles,
            filenames: grep.filenames.slice(0, 3),
          },
          grep_text_alias: {
            mode: grepTextAlias.mode,
            numFiles: grepTextAlias.numFiles,
            filenames: grepTextAlias.filenames.slice(0, 3),
          },
          grep_search_single_file: {
            numFiles: grepSingleFile.numFiles,
            filenames: grepSingleFile.filenames,
          },
          grep_search_regex: {
            numFiles: grepRegex.numFiles,
            appliedLimit: grepRegex.appliedLimit,
            appliedOffset: grepRegex.appliedOffset,
            mode: grepRegex.mode,
          },
          grep_search_content: {
            numLines: grepContent.numLines,
            appliedLimit: grepContent.appliedLimit,
            appliedOffset: grepContent.appliedOffset,
            mode: grepContent.mode,
          },
          grep_search_flag_aliases: {
            numFiles: grepFlagAliases.numFiles,
            numLines: grepFlagAliases.numLines,
            mode: grepFlagAliases.mode,
          },
          list_files: {
            totalEntryCount: list.totalEntryCount,
            returnedEntryCount: list.returnedEntryCount,
            truncated: list.truncated,
            omittedEntryCount: list.omittedEntryCount,
          },
          glob_search: {
            numFiles: glob.numFiles,
            truncated: glob.truncated,
            filenames: glob.filenames.slice(0, 3),
          },
          bash: {
            interrupted: bash.interrupted,
            returnCodeInterpretation: bash.returnCodeInterpretation,
            noOutputExpected: bash.noOutputExpected,
            filesystemMode: bash.sandboxStatus?.filesystem_mode,
          },
          bash_timeout: {
            interrupted: bashTimeout.interrupted,
            returnCodeInterpretation: bashTimeout.returnCodeInterpretation,
            noOutputExpected: bashTimeout.noOutputExpected,
          },
          bash_background: {
            backgroundTaskId: bashBackground.backgroundTaskId,
            backgroundedByUser: bashBackground.backgroundedByUser,
            noOutputExpected: bashBackground.noOutputExpected,
          },
          bash_sandbox_disabled: {
            enabled: bashSandboxDisabled.sandboxStatus.enabled,
            requestedEnabled: bashSandboxDisabled.sandboxStatus.requested.enabled,
            requestedMounts: bashSandboxDisabled.sandboxStatus.requested.allowed_mounts,
            allowedMounts: bashSandboxDisabled.sandboxStatus.allowed_mounts,
          },
          web_fetch: {
            code: webFetch.code,
            url: webFetch.url,
            result: webFetch.result,
          },
          web_search: {
            query: webSearch.query,
            durationSeconds: webSearch.durationSeconds,
            hits: webSearchHits,
          },
          tool_search: {
            query: toolSearch.query,
            normalizedQuery: toolSearch.normalized_query,
            matches: toolSearch.matches,
            totalDeferredTools: toolSearch.total_deferred_tools,
          },
          skill: {
            skill: skill.skill,
            path: skill.path,
            args: skill.args,
            description: skill.description,
          },
          delegated_explore: {
            subagentType: delegated.subagentType,
            status: delegatedCompletedTask.status,
            result: delegatedCompletedManifest.result,
            derivedState: delegatedCompletedManifest.derivedState,
            lastLaneEvent: delegatedCompletedManifest.laneEvents.at(-1)?.event ?? null,
          },
          delegated_plan: {
            subagentType: delegatedPlan.subagentType,
            status: delegatedPlanTask.status,
            result: delegatedPlanManifest.result,
            derivedState: delegatedPlanManifest.derivedState,
            lastLaneEvent: delegatedPlanManifest.laneEvents.at(-1)?.event ?? null,
          },
          task_list: {
            count: taskList.count,
            firstTaskId: taskList.tasks[0]?.task_id ?? null,
          },
          task_get: {
            taskId: delegatedTask.task_id,
            status: delegatedTask.status,
            subagentType: delegatedTask.subagent_type,
          },
          task_output: {
            taskId: delegatedTaskOutput.task_id,
            output: delegatedTaskOutput.output,
          },
          task_create: {
            taskId: createdPromptTask.task_id,
            status: createdPromptTask.status,
          },
          run_task_packet: {
            taskId: createdPacketTask.task_id,
            status: createdPacketTask.status,
          },
          planning_search: {
            query: planningSearch.query,
            matches: planningSearch.matches,
          },
          write_file_create: {
            type: writeCreate.type,
            originalFile: writeCreate.originalFile,
            oldLines: writeCreate.structuredPatch[0]?.oldLines,
            newLines: writeCreate.structuredPatch[0]?.newLines,
          },
          write_file_update: {
            type: writeUpdate.type,
            originalFile: writeUpdate.originalFile,
            oldLines: writeUpdate.structuredPatch[0]?.oldLines,
            newLines: writeUpdate.structuredPatch[0]?.newLines,
          },
          edit_file_once: {
            replaceAll: editOnce.replaceAll,
            oldString: editOnce.oldString,
            newString: editOnce.newString,
          },
          edit_file_all: {
            replaceAll: editAll.replaceAll,
            path: editAll.path,
          },
          read_file_large_guard: {
            reason: oversizedRead.reason,
            fileBytes: oversizedRead.fileBytes,
            maxFileBytes: oversizedRead.maxFileBytes,
          },
          read_file_large_window: {
            reason: oversizedWindowRead.reason,
            skipped: oversizedWindowRead.skipped,
            maxFileBytes: oversizedWindowRead.maxFileBytes,
          },
          read_file_limit_clamp: {
            type: clampedWindowRead.type,
            numLines: clampedWindowRead.file.numLines,
            startLine: clampedWindowRead.file.startLine,
          },
          bash_file_dump_guard: guardedBash.guard,
          bash_head_guard: guardedHead.guard,
          bash_head_numeric_guard: guardedHeadNumeric.guard,
          bash_tail_pipe_guard: guardedTailPipe.guard,
          bash_wc_head_guard: guardedWcThenHead.guard,
          bash_node_read_guard: guardedNodeRead.guard,
          tool_families: {
            read_file: toolRegistry.getToolMetadata("read_file"),
            grep_search: toolRegistry.getToolMetadata("grep_search"),
            grep_text: toolRegistry.getToolMetadata("grep_text"),
            list_files: toolRegistry.getToolMetadata("list_files"),
            write_file: toolRegistry.getToolMetadata("write_file"),
            edit_file: toolRegistry.getToolMetadata("edit_file"),
            bash: toolRegistry.getToolMetadata("bash"),
            WebFetch: toolRegistry.getToolMetadata("WebFetch"),
            WebSearch: toolRegistry.getToolMetadata("WebSearch"),
            TodoWrite: toolRegistry.getToolMetadata("TodoWrite"),
            Skill: toolRegistry.getToolMetadata("Skill"),
            ToolSearch: toolRegistry.getToolMetadata("ToolSearch"),
            StructuredOutput: toolRegistry.getToolMetadata("StructuredOutput"),
          },
          pre_tool_use_trace: {
            blockedToolCall,
            blockedResult,
          },
          runtime_decision_trace: {
            journalLength: decisionRun.decisionJournal.length,
            firstEntry: decisionRun.decisionJournal[0],
            secondEntry: decisionRun.decisionJournal[1],
            finalEntry: decisionRun.decisionJournal[2],
          },
        },
      },
      null,
      2,
    ),
  );

  } finally {
    await new Promise((resolve, reject) => {
      webFixture.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
        details: error.details ?? null,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
