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
  const workspaceRealPath = await realpath(workspaceRoot);
  const candidatePath = path.resolve(workspaceRoot, inputPath);

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
