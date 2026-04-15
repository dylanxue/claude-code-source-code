import { realpath } from "node:fs/promises";
import path from "node:path";

export function defaultFileWriteConfig() {
  return {
    maxWriteFileBytes: Number(
      process.env.WRITE_FILE_MAX_BYTES ?? process.env.EDIT_FILE_MAX_BYTES ?? 10 * 1024 * 1024,
    ),
    binaryProbeBytes: Number(process.env.FILE_OPS_BINARY_PROBE_BYTES ?? 8192),
  };
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function shouldIgnoreWorkspaceBoundary(ignoreWorkspaceBoundary = null) {
  if (typeof ignoreWorkspaceBoundary === "boolean") {
    return ignoreWorkspaceBoundary;
  }

  return parseBooleanFlag(
    process.env.TOOLS_IGNORE_WORKSPACE_BOUNDARY ?? process.env.FILE_OPS_IGNORE_WORKSPACE_BOUNDARY,
    false,
  );
}

export function rustStyleLines(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return [];
  }

  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function isPathInsideWorkspace(resolvedPath, workspaceRealPath) {
  const relativeToWorkspace = path.relative(workspaceRealPath, resolvedPath);
  return !(
    relativeToWorkspace === ".." ||
    relativeToWorkspace.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToWorkspace)
  );
}

async function tryRealpath(targetPath) {
  try {
    return await realpath(targetPath);
  } catch {
    return null;
  }
}

export function makeStructuredPatch(original, updated) {
  const originalLines = rustStyleLines(original);
  const updatedLines = rustStyleLines(updated);
  const lines = [];

  for (const line of originalLines) {
    lines.push(`-${line}`);
  }

  for (const line of updatedLines) {
    lines.push(`+${line}`);
  }

  return [
    {
      oldStart: 1,
      oldLines: originalLines.length,
      newStart: 1,
      newLines: updatedLines.length,
      lines,
    },
  ];
}

export function isBinaryBuffer(buffer, binaryProbeBytes) {
  return buffer.subarray(0, Math.max(1, binaryProbeBytes)).includes(0);
}

export async function resolveWorkspaceFilePath(workspaceRoot, inputPath, { allowMissing = false } = {}) {
  const candidatePath = path.resolve(workspaceRoot, inputPath);
  const ignoreWorkspaceBoundary = shouldIgnoreWorkspaceBoundary();

  if (ignoreWorkspaceBoundary) {
    if (!allowMissing) {
      return {
        candidatePath,
        targetPath: await realpath(candidatePath),
        existed: true,
      };
    }

    const existingRealPath = await tryRealpath(candidatePath);
    return {
      candidatePath,
      targetPath: existingRealPath ?? candidatePath,
      existed: Boolean(existingRealPath),
    };
  }

  const workspaceRealPath = await realpath(workspaceRoot);

  if (!allowMissing) {
    const targetRealPath = await realpath(candidatePath);
    if (!isPathInsideWorkspace(targetRealPath, workspaceRealPath)) {
      throw new Error(`Path escapes workspace boundary: ${inputPath}`);
    }

    return {
      candidatePath,
      targetPath: targetRealPath,
      existed: true,
    };
  }

  const existingRealPath = await tryRealpath(candidatePath);
  if (existingRealPath) {
    if (!isPathInsideWorkspace(existingRealPath, workspaceRealPath)) {
      throw new Error(`Path escapes workspace boundary: ${inputPath}`);
    }

    return {
      candidatePath,
      targetPath: existingRealPath,
      existed: true,
    };
  }

  let probePath = path.dirname(candidatePath);
  while (true) {
    const resolvedProbePath = await tryRealpath(probePath);
    if (resolvedProbePath) {
      if (!isPathInsideWorkspace(resolvedProbePath, workspaceRealPath)) {
        throw new Error(`Path escapes workspace boundary: ${inputPath}`);
      }

      return {
        candidatePath,
        targetPath: candidatePath,
        existed: false,
      };
    }

    const nextProbePath = path.dirname(probePath);
    if (nextProbePath === probePath) {
      throw new Error(`Path escapes workspace boundary: ${inputPath}`);
    }
    probePath = nextProbePath;
  }
}
