import process from "node:process";
import { mkdir, readFile as readFileFromDisk, rm, writeFile as writeFileToDisk } from "node:fs/promises";
import path from "node:path";

import { AgentRuntime } from "../src/core/agent-runtime.js";
import { buildPreToolUseBlockResult } from "../src/core/pre-tool-use-hooks.js";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { bashTool } from "../src/tools/bash.js";
import { editFileTool } from "../src/tools/edit-file.js";
import { globSearchTool } from "../src/tools/glob-search.js";
import { grepSearchTool, grepTextTool } from "../src/tools/grep-text.js";
import { listFilesTool } from "../src/tools/list-files.js";
import { readFileTool } from "../src/tools/read-file.js";
import { writeFileTool } from "../src/tools/write-file.js";

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function run() {
  const workspaceRoot = process.cwd();
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(readFileTool);
  toolRegistry.register(grepSearchTool);
  toolRegistry.register(grepTextTool);
  toolRegistry.register(listFilesTool);
  toolRegistry.register(globSearchTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(editFileTool);
  toolRegistry.register(bashTool);

  process.env.LIST_FILES_MAX_ENTRIES = "3";
  process.env.GREP_TEXT_MAX_MATCHES = "10";
  process.env.BASH_MAX_OUTPUT_CHARS = "120";
  process.env.WRITE_FILE_MAX_BYTES = "1000000";
  process.env.READ_FILE_MAX_BYTES = "1000000";
  process.env.READ_FILE_MAX_WINDOW_LINES = "20";

  const tempRoot = path.join(workspaceRoot, ".tmp-smoke");
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });

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
    bashSandboxDisabled.sandboxStatus.allowed_mounts[0].endsWith(path.join("agent-study", "lesson10", "src")),
    "bash should normalize allow-list mounts relative to the workspace root",
    bashSandboxDisabled,
  );

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
  assert(Array.isArray(decisionRun.decisionJournal), "runtime should return a decision journal in lesson10", decisionRun);
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

  await rm(tempRoot, { recursive: true, force: true });
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
