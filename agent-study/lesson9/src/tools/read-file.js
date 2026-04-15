import { readFile, stat } from "node:fs/promises";

import {
  isBinaryBuffer,
  resolveWorkspaceFilePath,
  rustStyleLines,
} from "./file-ops.js";

function defaultReadFileConfig() {
  return {
    maxReadFileBytes: Number(
      process.env.READ_FILE_MAX_BYTES ??
        process.env.READ_FILE_MAX_FILE_BYTES ??
        process.env.READ_FILE_MAX_WINDOW_FILE_BYTES ??
        10 * 1024 * 1024,
    ),
    maxWindowLines: Number(process.env.READ_FILE_MAX_WINDOW_LINES ?? 250),
    binaryProbeBytes: Number(process.env.READ_FILE_BINARY_PROBE_BYTES ?? 8192),
  };
}

function normalizeRequestedLimit(limit, maxWindowLines, windowRequested) {
  if (limit === undefined || limit === null) {
    if (windowRequested) {
      return {
        requestedLimit: null,
        appliedLimit: Math.max(1, maxWindowLines),
        limitClamped: false,
        defaultLimitApplied: true,
      };
    }

    return {
      requestedLimit: null,
      appliedLimit: null,
      limitClamped: false,
      defaultLimitApplied: false,
    };
  }

  const requestedLimit = Math.max(1, Number(limit));
  const appliedLimit = Math.min(requestedLimit, Math.max(1, maxWindowLines));
  return {
    requestedLimit,
    appliedLimit,
    limitClamped: appliedLimit !== requestedLimit,
    defaultLimitApplied: false,
  };
}

function selectLineWindow(text, input, config) {
  const lines = rustStyleLines(text);
  const totalLineCount = lines.length;
  const startIndex = Math.max(0, Math.min(Number(input.offset ?? 0), totalLineCount));
  const { requestedLimit, appliedLimit, limitClamped, defaultLimitApplied } = normalizeRequestedLimit(
    input.limit,
    config.maxWindowLines,
    true,
  );
  const endIndex =
    appliedLimit === null ? totalLineCount : Math.min(totalLineCount, startIndex + appliedLimit);
  const selectedLines = lines.slice(startIndex, endIndex);
  const content = selectedLines.join("\n");
  const numLines = selectedLines.length;
  const truncated = startIndex > 0 || endIndex < totalLineCount;

  return {
    content,
    truncated,
    totalLineCount,
    startLine: startIndex + 1,
    numLines,
    omittedLineCount: Math.max(0, totalLineCount - numLines),
    appliedOffset: startIndex,
    requestedLimit,
    appliedLimit,
    limitClamped,
    defaultLimitApplied,
  };
}

export const readFileTool = {
  name: "read_file",
  family: "file_read",
  description: "Read a text file from the workspace.",
  inputSchema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" },
    },
  },
  async execute(input, context) {
    const config = defaultReadFileConfig();
    const { targetPath } = await resolveWorkspaceFilePath(context.workspaceRoot, input.path);
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${input.path}`);
    }

    const fileTooLarge = fileStat.size > config.maxReadFileBytes;

    if (fileTooLarge) {
      return {
        path: input.path,
        truncated: true,
        skipped: true,
        reason: "file_too_large",
        fileBytes: fileStat.size,
        maxFileBytes: config.maxReadFileBytes,
        enforcement: {
          kind: "block_direct_file_dump_follow_up",
          path: input.path,
          sourceTool: "read_file",
        },
      };
    }

    const contentBuffer = await readFile(targetPath);
    if (isBinaryBuffer(contentBuffer, config.binaryProbeBytes)) {
      throw new Error("file appears to be binary");
    }
    const content = contentBuffer.toString("utf8");
    const windowed = selectLineWindow(content, input, config);

    return {
      type: "text",
      file: {
        filePath: targetPath,
        content: windowed.content,
        numLines: windowed.numLines,
        startLine: windowed.startLine,
        totalLines: windowed.totalLineCount,
      },
    };
  },
};
