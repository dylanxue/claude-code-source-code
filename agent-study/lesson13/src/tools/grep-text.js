import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspaceFilePath } from "./file-ops.js";

function grepConfig() {
  return {
    maxMatches: Number(process.env.GREP_TEXT_MAX_MATCHES ?? 250),
    maxFileBytes: Number(process.env.GREP_TEXT_MAX_FILE_BYTES ?? 256_000),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(globPattern) {
  const source = String(globPattern ?? "")
    .split("")
    .map((char) => {
      if (char === "*") {
        return ".*";
      }
      if (char === "?") {
        return ".";
      }
      return escapeRegExp(char);
    })
    .join("");

  return new RegExp(`^${source}$`);
}

function normalizeOutputMode(outputMode) {
  const normalized = String(outputMode ?? "files_with_matches").trim();
  if (!normalized) {
    return "files_with_matches";
  }

  if (normalized === "matches") {
    return "files_with_matches";
  }

  return normalized;
}

function normalizeLimit(limit, fallback) {
  if (limit === undefined || limit === null) {
    return fallback;
  }

  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}

function normalizeOffset(offset) {
  if (offset === undefined || offset === null) {
    return 0;
  }

  const parsed = Number(offset);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function matchesGlob(filePath, globPattern) {
  if (!globPattern) {
    return true;
  }

  const matcher = globToRegExp(globPattern);
  const normalizedPath = filePath.split(path.sep).join("/");
  return matcher.test(normalizedPath) || matcher.test(path.basename(normalizedPath));
}

function matchesFileType(filePath, fileType) {
  if (!fileType) {
    return true;
  }

  const normalizedType = String(fileType).replace(/^\./, "");
  return path.extname(filePath).replace(/^\./, "") === normalizedType;
}

function buildPatternMatcher(input) {
  const pattern = String(input.pattern ?? "");
  const caseInsensitive = Boolean(input.case_insensitive ?? input.caseInsensitive ?? input["-i"]);
  const multiline = Boolean(input.multiline);
  const flags = `${caseInsensitive ? "i" : ""}g${multiline ? "s" : ""}`;
  return {
    type: "regex",
    regex: new RegExp(pattern, flags),
    caseInsensitive,
    multiline,
  };
}

function resolveContextBefore(input) {
  const sharedContext = input.context ?? input["-C"];
  return normalizeOffset(sharedContext ?? input.before ?? input["-B"]);
}

function resolveContextAfter(input) {
  const sharedContext = input.context ?? input["-C"];
  return normalizeOffset(sharedContext ?? input.after ?? input["-A"]);
}

async function walkFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function buildLineStarts(lines) {
  const starts = [];
  let position = 0;
  for (const line of lines) {
    starts.push(position);
    position += line.length + 1;
  }
  return starts;
}

function lineIndexForCharOffset(lineStarts, charOffset) {
  let result = 0;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] > charOffset) {
      break;
    }
    result = index;
  }
  return result;
}

function findMatchesInFile(content, filePath, matcher) {
  const regex = new RegExp(matcher.regex.source, matcher.regex.flags);
  const lines = content.split("\n");
  const lineStarts = buildLineStarts(lines);
  const matchLineIndexes = [];

  let match = regex.exec(content);
  while (match) {
    const matchedText = match[0] ?? "";
    const lineIndex = lineIndexForCharOffset(lineStarts, match.index);
    matchLineIndexes.push(lineIndex);

    if (matchedText.length === 0) {
      regex.lastIndex += 1;
    }
    match = regex.exec(content);
  }

  return matchLineIndexes;
}

function buildContentLines({ filePath, lines, matchLineIndexes, contextBefore, contextAfter, lineNumbers }) {
  const ranges = [];
  for (const lineIndex of matchLineIndexes) {
    ranges.push({
      start: Math.max(0, lineIndex - contextBefore),
      end: Math.min(lines.length - 1, lineIndex + contextAfter),
    });
  }

  const mergedRanges = [];
  for (const range of ranges) {
    const previous = mergedRanges.at(-1);
    if (!previous || range.start > previous.end + 1) {
      mergedRanges.push(range);
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }

  const contentLines = [];
  for (const range of mergedRanges) {
    for (let index = range.start; index <= range.end; index += 1) {
      const prefix = lineNumbers === false ? `${filePath}:` : `${filePath}:${index + 1}:`;
      contentLines.push(`${prefix}${lines[index]}`);
    }
  }

  return contentLines;
}

function applyLimit(items, headLimit, offset, fallbackLimit) {
  const appliedOffset = normalizeOffset(offset);
  const explicitLimit =
    headLimit === undefined || headLimit === null ? normalizeLimit(undefined, fallbackLimit ?? 250) : normalizeLimit(headLimit, fallbackLimit ?? 250);
  if (explicitLimit === 0) {
    return {
      items: items.slice(appliedOffset),
      appliedLimit: null,
      appliedOffset: appliedOffset > 0 ? appliedOffset : null,
      truncated: false,
      omittedCount: 0,
    };
  }

  const sliced = items.slice(appliedOffset, appliedOffset + explicitLimit);
  const truncated = items.slice(appliedOffset).length > explicitLimit;
  return {
    items: sliced,
    appliedLimit: truncated ? explicitLimit : null,
    appliedOffset: appliedOffset > 0 ? appliedOffset : null,
    truncated,
    omittedCount: Math.max(0, items.slice(appliedOffset).length - sliced.length),
  };
}

const grepSearchSchema = {
  type: "object",
  required: ["pattern"],
  properties: {
    pattern: { type: "string" },
    path: { type: "string" },
    regex: { type: "boolean" },
    glob: { type: "string" },
    output_mode: { type: "string" },
    "-B": { type: "number" },
    "-A": { type: "number" },
    "-C": { type: "number" },
    context: { type: "number" },
    "-n": { type: "boolean" },
    "-i": { type: "boolean" },
    head_limit: { type: "number" },
    offset: { type: "number" },
    type: { type: "string" },
    file_type: { type: "string" },
    case_insensitive: { type: "boolean" },
    multiline: { type: "boolean" },
    line_numbers: { type: "boolean" },
  },
};

async function executeGrepSearch(input, context) {
    const config = grepConfig();
    const matcher = buildPatternMatcher(input);
    const outputMode = normalizeOutputMode(input.output_mode);
    const basePath = input.path ?? ".";
    const { targetPath } = await resolveWorkspaceFilePath(context.workspaceRoot, basePath);
    const files = await readdir(targetPath, { withFileTypes: true })
      .then(async (entries) => {
        const resolved = [];
        for (const entry of entries) {
          const fullPath = path.join(targetPath, entry.name);
          if (entry.isDirectory()) {
            resolved.push(...(await walkFiles(fullPath)));
          } else if (entry.isFile()) {
            resolved.push(fullPath);
          }
        }
        return resolved;
      })
      .catch(async () => [targetPath]);

    const matchedFiles = [];
    const allContentLines = [];
    let totalMatches = 0;

    for (const filePath of files) {
      const content = await readFile(filePath, "utf8").catch(() => null);
      if (content === null) {
        continue;
      }

      if (Buffer.byteLength(content, "utf8") > config.maxFileBytes) {
        continue;
      }

      if (!matchesGlob(filePath, input.glob)) {
        continue;
      }
      if (!matchesFileType(filePath, input.file_type ?? input.type)) {
        continue;
      }

      const matchLineIndexes = findMatchesInFile(content, filePath, matcher);
      if (matchLineIndexes.length === 0) {
        continue;
      }

      matchedFiles.push(filePath);
      totalMatches += matchLineIndexes.length;

      if (outputMode === "content") {
        const lines = content.split("\n");
        allContentLines.push(
          ...buildContentLines({
            filePath,
            lines,
            matchLineIndexes: [...new Set(matchLineIndexes)],
            contextBefore: resolveContextBefore(input),
            contextAfter: resolveContextAfter(input),
            lineNumbers: input.line_numbers ?? input["-n"],
          }),
        );
      }
    }

    const limitedFiles = applyLimit(matchedFiles, input.head_limit, input.offset, config.maxMatches);
    const limitedContentLines = applyLimit(allContentLines, input.head_limit, input.offset, config.maxMatches);

    return {
      mode: outputMode,
      numFiles: limitedFiles.items.length,
      filenames: limitedFiles.items,
      content: outputMode === "content" ? limitedContentLines.items.join("\n") : null,
      numLines: outputMode === "content" ? limitedContentLines.items.length : null,
      numMatches: outputMode === "count" ? totalMatches : null,
      appliedLimit:
        outputMode === "content" ? limitedContentLines.appliedLimit : limitedFiles.appliedLimit,
      appliedOffset:
        outputMode === "content" ? limitedContentLines.appliedOffset : limitedFiles.appliedOffset,
    };
}

export const grepSearchTool = {
  name: "grep_search",
  family: "search",
  description: "Search file contents with a regex pattern.",
  inputSchema: grepSearchSchema,
  execute: executeGrepSearch,
};

export const grepTextTool = {
  ...grepSearchTool,
  name: "grep_text",
};
