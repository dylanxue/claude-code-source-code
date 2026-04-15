import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createContinuation } from "./tool-continuation.js";

const execFileAsync = promisify(execFile);

function defaultBashOutputConfig() {
  return {
    maxCharsPerStream: Number(process.env.BASH_MAX_OUTPUT_CHARS ?? 4000),
    maxLinesPerStream: Number(process.env.BASH_MAX_OUTPUT_LINES ?? 120),
    fileReadGuardMaxBytes: Number(
      process.env.BASH_FILE_READ_GUARD_MAX_BYTES ?? process.env.READ_FILE_MAX_FILE_BYTES ?? 512_000,
    ),
  };
}

function assertSafeCommand(command) {
  const blockedFragments = ["rm -rf", "git reset --hard", "shutdown", "reboot", ":(){:|:&};:"];

  for (const fragment of blockedFragments) {
    if (command.includes(fragment)) {
      throw new Error(`Blocked command fragment detected: ${fragment}`);
    }
  }
}

function summarizeStream(text, config) {
  const normalized = String(text ?? "").trim();
  const charCount = normalized.length;
  const lines = normalized ? normalized.split("\n") : [];
  const lineCount = lines.length;

  let summarizedLines = lines;
  let omittedLineCount = 0;
  let truncated = false;

  if (lineCount > config.maxLinesPerStream) {
    const headCount = Math.max(1, Math.ceil(config.maxLinesPerStream * 0.75));
    const tailCount = Math.max(0, config.maxLinesPerStream - headCount);
    summarizedLines = [
      ...lines.slice(0, headCount),
      `... (${lineCount - config.maxLinesPerStream} lines omitted) ...`,
      ...lines.slice(Math.max(headCount, lineCount - tailCount)),
    ];
    omittedLineCount = Math.max(0, lineCount - config.maxLinesPerStream);
    truncated = true;
  }

  let summary = summarizedLines.join("\n");
  if (summary.length > config.maxCharsPerStream) {
    const reserveForMarker = 32;
    const headChars = Math.max(0, Math.floor((config.maxCharsPerStream - reserveForMarker) * 0.75));
    const tailChars = Math.max(0, config.maxCharsPerStream - reserveForMarker - headChars);
    summary = `${summary.slice(0, headChars)}\n... output truncated ...\n${summary.slice(Math.max(headChars, summary.length - tailChars))}`.slice(
      0,
      config.maxCharsPerStream,
    );
    truncated = true;
  }

  return {
    text: summary,
    truncated,
    charCount,
    lineCount,
    omittedLineCount,
  };
}

function firstDefined(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function extractDirectFileDumpDescriptor(command) {
  const normalized = String(command ?? "").trim();
  const patterns = [
    {
      mode: "cat",
      regex: /^\s*cat\s+(?:--\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "head",
      regex:
        /^\s*head\s+(?:-[A-Za-z]\s+)*(?:-n\s+\d+\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "head_numeric",
      regex:
        /^\s*head\s+-\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail",
      regex:
        /^\s*tail\s+(?:-[A-Za-z]\s+)*(?:-n\s+\d+\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail_numeric",
      regex:
        /^\s*tail\s+-\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail_from_line",
      regex:
        /^\s*tail\s+-n\s+\+\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail_then_head",
      regex:
        /^\s*tail\s+-n\s+\+\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*\|\s*head\s+-\d+\s*$/,
    },
    {
      mode: "wc_then_head",
      regex:
        /^\s*wc\s+-l\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*&&\s*head\s+-\d+\s+(?:"[^"]+"|'[^']+'|[^\s|><;&]+)\s*$/,
    },
    {
      mode: "wc_then_sed",
      regex:
        /^\s*wc\s+-l\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*&&\s*sed\s+-n\s+(?:"[^"]+"|'[^']+')\s+(?:"[^"]+"|'[^']+'|[^\s|><;&]+)\s*$/,
    },
    {
      mode: "sed_print",
      regex:
        /^\s*sed\s+-n\s+(?:"[^"]+"|'[^']+')\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "node_read_file_sync",
      regex:
        /^\s*node\s+-e\s+(?:"[^"]*readFileSync\(\s*'([^']+)'\s*,[^"]*"|'[^']*readFileSync\(\s*"([^"]+)"\s*,[^']*')\s*$/,
    },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const targetPath = firstDefined(match[1], match[2], match[3]);
      if (targetPath) {
        return {
          mode: pattern.mode,
          path: targetPath,
        };
      }
    }
  }

  return null;
}

async function maybeGuardDirectFileDump(command, workspaceRoot, config) {
  const descriptor = extractDirectFileDumpDescriptor(command);
  if (!descriptor) {
    return null;
  }

  const resolvedPath = path.resolve(workspaceRoot, descriptor.path);
  const fileStat = await stat(resolvedPath).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }

  if (!(config.fileReadGuardMaxBytes > 0) || fileStat.size <= config.fileReadGuardMaxBytes) {
    return null;
  }

  return {
    command,
    exitCode: 0,
    durationMs: 0,
    stdout: "",
    stderr: "",
    stdoutMeta: {
      truncated: false,
      charCount: 0,
      lineCount: 0,
      omittedLineCount: 0,
    },
    stderrMeta: {
      truncated: false,
      charCount: 0,
      lineCount: 0,
      omittedLineCount: 0,
    },
    guard: {
      blocked: true,
      reason: "file_too_large_for_direct_shell_dump",
      mode: descriptor.mode,
      filePath: descriptor.path,
      fileBytes: fileStat.size,
      maxFileBytes: config.fileReadGuardMaxBytes,
      suggestedTool: "read_file",
    },
    continuation: createContinuation({
      reason: "file_too_large_for_direct_shell_dump",
      summary: "Direct shell dumping of this file was blocked because the file exceeds the configured large-file guard.",
      strategy: "avoid_direct_file_dump",
      suggestedTool: "read_file",
      suggestedActions: [
        "Use read_file first to inspect the file metadata and preview budget.",
        "Use targeted shell queries like wc -l, grep -n, or a narrower pattern instead of dumping the whole file.",
        "Narrow the task to a specific symbol or section before reading more content.",
      ],
    }),
  };
}

export const bashTool = {
  name: "bash",
  description: "Run a shell command in the workspace with basic safety checks.",
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
    },
  },
  async execute(input, context) {
    const config = defaultBashOutputConfig();
    assertSafeCommand(input.command);
    const startedAt = Date.now();
    const guardedResult = await maybeGuardDirectFileDump(
      input.command,
      context.workspaceRoot,
      config,
    );
    if (guardedResult) {
      return guardedResult;
    }

    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", input.command], {
        cwd: context.workspaceRoot,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const stdoutSummary = summarizeStream(stdout, config);
      const stderrSummary = summarizeStream(stderr, config);

      return {
        command: input.command,
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        stdout: stdoutSummary.text,
        stderr: stderrSummary.text,
        stdoutMeta: {
          truncated: stdoutSummary.truncated,
          charCount: stdoutSummary.charCount,
          lineCount: stdoutSummary.lineCount,
          omittedLineCount: stdoutSummary.omittedLineCount,
        },
        stderrMeta: {
          truncated: stderrSummary.truncated,
          charCount: stderrSummary.charCount,
          lineCount: stderrSummary.lineCount,
          omittedLineCount: stderrSummary.omittedLineCount,
        },
        continuation:
          stdoutSummary.truncated || stderrSummary.truncated
            ? createContinuation({
                reason: "shell_output_truncated",
                summary: "Shell output was summarized because it exceeded the configured output budget.",
                strategy: "narrow_shell_output",
                suggestedTool: "bash",
                suggestedActions: [
                  "Refine the command so it prints fewer lines or a smaller region.",
                  "Prefer grep -n, wc -l, or other targeted shell queries over broad dumps.",
                ],
              })
            : null,
      };
    } catch (error) {
      const stdoutSummary = summarizeStream(error.stdout, config);
      const stderrSummary = summarizeStream(error.stderr ?? error.message, config);

      return {
        command: input.command,
        exitCode: error.code ?? 1,
        durationMs: Date.now() - startedAt,
        stdout: stdoutSummary.text,
        stderr: stderrSummary.text,
        stdoutMeta: {
          truncated: stdoutSummary.truncated,
          charCount: stdoutSummary.charCount,
          lineCount: stdoutSummary.lineCount,
          omittedLineCount: stdoutSummary.omittedLineCount,
        },
        stderrMeta: {
          truncated: stderrSummary.truncated,
          charCount: stderrSummary.charCount,
          lineCount: stderrSummary.lineCount,
          omittedLineCount: stderrSummary.omittedLineCount,
        },
        continuation:
          stdoutSummary.truncated || stderrSummary.truncated
            ? createContinuation({
                reason: "shell_output_truncated",
                summary: "Shell output was summarized because it exceeded the configured output budget.",
                strategy: "narrow_shell_output",
                suggestedTool: "bash",
                suggestedActions: [
                  "Refine the command so it prints fewer lines or a smaller region.",
                  "Prefer grep -n, wc -l, or other targeted shell queries over broad dumps.",
                ],
              })
            : null,
      };
    }
  },
};
