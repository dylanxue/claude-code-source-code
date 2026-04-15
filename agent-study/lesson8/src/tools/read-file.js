import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { createContinuation } from "./tool-continuation.js";

function defaultReadFileConfig() {
  return {
    maxPreviewChars: Number(process.env.READ_FILE_MAX_PREVIEW_CHARS ?? 6000),
    maxPreviewLines: Number(process.env.READ_FILE_MAX_PREVIEW_LINES ?? 200),
    maxFileBytes: Number(process.env.READ_FILE_MAX_FILE_BYTES ?? 512_000),
  };
}

function summarizeText(text, config) {
  const normalized = String(text ?? "");
  const totalCharCount = normalized.length;
  const lines = normalized.split("\n");
  const totalLineCount = lines.length;

  let previewLines = lines;
  let omittedLineCount = 0;
  let truncated = false;

  if (totalLineCount > config.maxPreviewLines) {
    const headCount = Math.max(1, Math.ceil(config.maxPreviewLines * 0.75));
    const tailCount = Math.max(0, config.maxPreviewLines - headCount);
    previewLines = [
      ...lines.slice(0, headCount),
      `... (${totalLineCount - config.maxPreviewLines} lines omitted) ...`,
      ...lines.slice(Math.max(headCount, totalLineCount - tailCount)),
    ];
    omittedLineCount = Math.max(0, totalLineCount - config.maxPreviewLines);
    truncated = true;
  }

  let preview = previewLines.join("\n");
  if (preview.length > config.maxPreviewChars) {
    const marker = "\n... file preview truncated ...\n";
    const availableChars = Math.max(0, config.maxPreviewChars - marker.length);
    const headChars = Math.max(0, Math.floor(availableChars * 0.75));
    const tailChars = Math.max(0, availableChars - headChars);
    preview = `${preview.slice(0, headChars)}${marker}${preview.slice(
      Math.max(headChars, preview.length - tailChars),
    )}`;
    truncated = true;
  }

  return {
    preview,
    truncated,
    totalCharCount,
    totalLineCount,
    omittedLineCount,
    omittedCharCount: Math.max(0, totalCharCount - preview.length),
  };
}

export const readFileTool = {
  name: "read_file",
  description: "Read a UTF-8 text file from the workspace.",
  inputSchema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
    },
  },
  async execute(input, context) {
    const config = defaultReadFileConfig();
    const targetPath = path.resolve(context.workspaceRoot, input.path);
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${input.path}`);
    }

    if (fileStat.size > config.maxFileBytes) {
      return {
        path: input.path,
        truncated: true,
        skipped: true,
        reason: "file_too_large",
        fileBytes: fileStat.size,
        maxFileBytes: config.maxFileBytes,
        preview: "",
        continuation: createContinuation({
          reason: "file_too_large",
          summary: "The file is larger than the configured read_file byte limit.",
          strategy: "avoid_broad_file_read",
          suggestedTool: "bash",
          suggestedActions: [
            "Use grep_text with a narrower pattern to find specific symbols or sections first.",
            "Use bash for targeted metadata queries like wc -l or grep -n instead of dumping the whole file.",
            "Narrow the task to a specific function, symbol, or section before reading more content.",
          ],
        }),
      };
    }

    const content = await readFile(targetPath, "utf8");
    const summary = summarizeText(content, config);

    return {
      path: input.path,
      fileBytes: fileStat.size,
      maxFileBytes: config.maxFileBytes,
      truncated: summary.truncated,
      totalCharCount: summary.totalCharCount,
      totalLineCount: summary.totalLineCount,
      omittedLineCount: summary.omittedLineCount,
      omittedCharCount: summary.omittedCharCount,
      preview: summary.preview,
      continuation: summary.truncated
        ? createContinuation({
            reason: "preview_truncated",
            summary: "Only a preview of the file was returned because the file exceeded the preview budget.",
            strategy: "narrow_file_region",
            suggestedTool: "bash",
            suggestedActions: [
              "If you only need one symbol, use grep_text or grep -n to locate it first.",
              "Use targeted shell queries like wc -l, grep -n, or sed -n for a smaller region instead of re-reading the whole file.",
            ],
          })
        : null,
    };
  },
};
