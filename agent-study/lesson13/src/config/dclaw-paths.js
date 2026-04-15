import os from "node:os";
import path from "node:path";

function expandHome(targetPath) {
  if (!targetPath || targetPath === "~") {
    return os.homedir();
  }

  if (targetPath.startsWith(`~${path.sep}`) || targetPath.startsWith("~/")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }

  return targetPath;
}

export function resolveDclawRoot(workspaceRoot = process.cwd()) {
  const configuredRoot = process.env.DCLAW_HOME;
  if (configuredRoot) {
    return path.resolve(expandHome(configuredRoot));
  }

  return path.resolve(workspaceRoot, ".dclaw");
}

export function resolveDclawChildPath(workspaceRoot, ...segments) {
  return path.join(resolveDclawRoot(workspaceRoot), ...segments);
}

export function workspaceFingerprint(workspaceRoot) {
  const input = String(path.resolve(workspaceRoot));
  let hash = 0xcbf29ce484222325n;

  for (const byte of Buffer.from(input, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
}

export function resolveWorkspaceScopedDclawChildPath(workspaceRoot, scope, ...segments) {
  return path.join(
    resolveDclawChildPath(workspaceRoot, scope),
    workspaceFingerprint(workspaceRoot),
    ...segments,
  );
}
