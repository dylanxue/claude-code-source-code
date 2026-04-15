import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { createContinuation } from "./tool-continuation.js";

function grepConfig() {
  return {
    maxMatches: Number(process.env.GREP_TEXT_MAX_MATCHES ?? 200),
    maxPreviewChars: Number(process.env.GREP_TEXT_MAX_PREVIEW_CHARS ?? 240),
    maxFileBytes: Number(process.env.GREP_TEXT_MAX_FILE_BYTES ?? 256_000),
    ignoredPathSegments: String(
      process.env.GREP_TEXT_IGNORED_PATH_SEGMENTS ?? ".git,.logs,.sessions,node_modules",
    )
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean),
  };
}

function truncatePreview(text, maxChars) {
  const normalized = String(text ?? "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function shouldIgnorePath(fullPath, config, workspaceRoot) {
  const relativePath = path.relative(workspaceRoot, fullPath);
  const segments = relativePath.split(path.sep).filter(Boolean);
  return config.ignoredPathSegments.some((segment) => segments.includes(segment));
}

async function walkFiles(rootPath, workspaceRoot, config, stats) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (shouldIgnorePath(fullPath, config, workspaceRoot)) {
      if (entry.isDirectory()) {
        stats.skippedDirectoryCount += 1;
      } else {
        stats.skippedFileCount += 1;
      }
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath, workspaceRoot, config, stats)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

export const grepTextTool = {
  name: "grep_text",
  description: "Search for a text pattern under a directory.",
  inputSchema: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
    },
  },
  async execute(input, context) {
    const config = grepConfig();
    const searchRoot = path.resolve(context.workspaceRoot, input.path ?? ".");
    const walkStats = {
      skippedDirectoryCount: 0,
      skippedFileCount: 0,
    };
    const files = await walkFiles(searchRoot, context.workspaceRoot, config, walkStats);
    const matches = [];
    let totalMatches = 0;
    let matchedFileCount = 0;
    let skippedLargeFileCount = 0;
    let skippedUnreadableFileCount = 0;

    for (const filePath of files) {
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        skippedUnreadableFileCount += 1;
        continue;
      }

      if (fileStat.size > config.maxFileBytes) {
        skippedLargeFileCount += 1;
        continue;
      }

      const content = await readFile(filePath, "utf8").catch(() => null);

      if (!content) {
        skippedUnreadableFileCount += 1;
        continue;
      }

      const lines = content.split("\n");
      let fileMatched = false;

      lines.forEach((line, index) => {
        if (line.includes(input.pattern)) {
          totalMatches += 1;
          fileMatched = true;
          if (matches.length < config.maxMatches) {
            matches.push({
              path: path.relative(context.workspaceRoot, filePath),
              line: index + 1,
              preview: truncatePreview(line, config.maxPreviewChars),
            });
          }
        }
      });

      if (fileMatched) {
        matchedFileCount += 1;
      }
    }

    return {
      pattern: input.pattern,
      path: input.path ?? ".",
      scannedFileCount: files.length,
      searchedFileCount: files.length - skippedLargeFileCount - skippedUnreadableFileCount,
      matchedFileCount,
      totalMatchCount: totalMatches,
      returnedMatchCount: matches.length,
      truncated: totalMatches > matches.length,
      omittedMatchCount: Math.max(0, totalMatches - matches.length),
      skippedDirectoryCount: walkStats.skippedDirectoryCount,
      skippedFileCount: walkStats.skippedFileCount,
      skippedLargeFileCount,
      skippedUnreadableFileCount,
      maxFileBytes: config.maxFileBytes,
      ignoredPathSegments: config.ignoredPathSegments,
      matches,
      continuation:
        totalMatches > matches.length || skippedLargeFileCount > 0 || walkStats.skippedDirectoryCount > 0
          ? createContinuation({
              reason:
                totalMatches > matches.length
                  ? "match_list_truncated"
                  : skippedLargeFileCount > 0
                    ? "large_files_skipped"
                    : "noise_directories_skipped",
              summary:
                totalMatches > matches.length
                  ? "Only part of the match list was returned because the search exceeded the match budget."
                  : skippedLargeFileCount > 0
                    ? "Some large files were skipped during search to avoid oversized tool output."
                    : "Some high-noise directories were skipped to keep search results focused.",
              strategy:
                totalMatches > matches.length
                  ? "narrow_search"
                  : skippedLargeFileCount > 0
                    ? "narrow_search"
                    : "narrow_path",
              suggestedTool: "grep_text",
              suggestedActions: [
                "Search inside a narrower path to reduce result volume.",
                "Use a more specific pattern to target one symbol, file, or phrase.",
                "If you need file structure first, call list_files on a smaller directory before searching again.",
              ],
            })
          : null,
    };
  },
};
