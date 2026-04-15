import process from "node:process";

import { applyToolResultBudget } from "../src/core/tool-result-budget.js";
import { bashTool } from "../src/tools/bash.js";
import { grepTextTool } from "../src/tools/grep-text.js";
import { listFilesTool } from "../src/tools/list-files.js";
import { readFileTool } from "../src/tools/read-file.js";

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function run() {
  const workspaceRoot = process.cwd();

  process.env.LIST_FILES_MAX_ENTRIES = "3";
  process.env.GREP_TEXT_MAX_MATCHES = "10";
  process.env.BASH_MAX_OUTPUT_LINES = "5";
  process.env.BASH_MAX_OUTPUT_CHARS = "120";
  process.env.READ_FILE_MAX_FILE_BYTES = "1000000";

  const read = await readFileTool.execute(
    { path: "src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(typeof read.totalCharCount === "number", "read_file should report totalCharCount", read);
  assert(typeof read.totalLineCount === "number", "read_file should report totalLineCount", read);

  const grep = await grepTextTool.execute(
    { pattern: "lesson7", path: "." },
    { workspaceRoot },
  );
  assert(Array.isArray(grep.ignoredPathSegments), "grep_text should report ignoredPathSegments", grep);
  assert(typeof grep.skippedDirectoryCount === "number", "grep_text should report skippedDirectoryCount", grep);
  assert(grep.continuation?.reason, "grep_text should provide continuation metadata when filtered", grep);

  const list = await listFilesTool.execute(
    { path: "src/tools" },
    { workspaceRoot },
  );
  assert(list.truncated === true, "list_files should truncate under LIST_FILES_MAX_ENTRIES=3", list);
  assert(list.returnedEntryCount === 3, "list_files should return 3 entries under limit", list);
  assert(list.continuation?.reason === "entry_list_truncated", "list_files should provide continuation metadata", list);

  const bash = await bashTool.execute(
    { command: 'printf "1\\n2\\n3\\n4\\n5\\n6\\n7\\n"' },
    { workspaceRoot },
  );
  assert(bash.exitCode === 0, "bash should exit successfully", bash);
  assert(bash.stdoutMeta?.truncated === true, "bash stdout should be marked truncated", bash);
  assert(bash.continuation?.reason === "shell_output_truncated", "bash should provide continuation metadata on truncation", bash);

  const budgeted = applyToolResultBudget(
    "grep_text",
    {
      matches: Array.from({ length: 50 }, (_, index) => ({
        line: index + 1,
        preview: "x".repeat(200),
      })),
    },
    {
      maxSerializedChars: 120,
      maxStringChars: 80,
      maxArrayItems: 5,
      maxObjectKeys: 10,
      maxDepth: 4,
      depthPreviewChars: 40,
      summaryPreviewChars: 60,
    },
  );
  assert(budgeted.budget?.truncated === true, "tool result budget should trigger truncation", budgeted);
  assert(
    budgeted.budget?.storedEstimatedChars <= 120,
    "tool result budget should fit within serialized budget",
    budgeted,
  );

  process.env.READ_FILE_MAX_FILE_BYTES = "100";
  const oversizedRead = await readFileTool.execute(
    { path: "src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(oversizedRead.reason === "file_too_large", "read_file should report file_too_large", oversizedRead);
  assert(oversizedRead.continuation?.reason === "file_too_large", "read_file should provide continuation metadata", oversizedRead);

  const guardedBash = await bashTool.execute(
    { command: "cat src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert(
    guardedBash.guard?.reason === "file_too_large_for_direct_shell_dump",
    "bash should guard direct large file dumps",
    guardedBash,
  );
  assert(
    guardedBash.continuation?.reason === "file_too_large_for_direct_shell_dump",
    "bash should provide continuation metadata for guarded file dumps",
    guardedBash,
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
            truncated: read.truncated,
            totalCharCount: read.totalCharCount,
            totalLineCount: read.totalLineCount,
          },
          grep_text: {
            totalMatchCount: grep.totalMatchCount,
            returnedMatchCount: grep.returnedMatchCount,
            skippedDirectoryCount: grep.skippedDirectoryCount,
            ignoredPathSegments: grep.ignoredPathSegments,
            continuation: grep.continuation,
          },
          list_files: {
            totalEntryCount: list.totalEntryCount,
            returnedEntryCount: list.returnedEntryCount,
            truncated: list.truncated,
            continuation: list.continuation,
          },
          bash: {
            exitCode: bash.exitCode,
            stdoutMeta: bash.stdoutMeta,
            continuation: bash.continuation,
          },
          tool_result_budget: budgeted.budget,
          read_file_large_guard: {
            reason: oversizedRead.reason,
            fileBytes: oversizedRead.fileBytes,
            maxFileBytes: oversizedRead.maxFileBytes,
            continuation: oversizedRead.continuation,
          },
          bash_file_dump_guard: guardedBash.guard,
          bash_head_guard: guardedHead.guard,
          bash_head_numeric_guard: guardedHeadNumeric.guard,
          bash_tail_pipe_guard: guardedTailPipe.guard,
          bash_wc_head_guard: guardedWcThenHead.guard,
          bash_node_read_guard: guardedNodeRead.guard,
        },
      },
      null,
      2,
    ),
  );
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
