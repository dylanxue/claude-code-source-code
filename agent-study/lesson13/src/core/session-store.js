import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  resolveDclawChildPath,
  resolveDclawRoot,
  resolveWorkspaceScopedDclawChildPath,
} from "../config/dclaw-paths.js";

function timestampId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createSessionId() {
  return `session-${timestampId()}`;
}

export function ensureSessionsDir(workspaceRoot) {
  const sessionsDir = resolveWorkspaceScopedDclawChildPath(workspaceRoot, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  return sessionsDir;
}

function legacySessionsDir(workspaceRoot) {
  return resolveDclawChildPath(workspaceRoot, "sessions");
}

export function sessionFilePath(workspaceRoot, sessionId) {
  return path.join(ensureSessionsDir(workspaceRoot), `${sessionId}.json`);
}

export function saveSessionToFile(workspaceRoot, session) {
  const filePath = session.persistencePath ?? sessionFilePath(workspaceRoot, session.sessionId);
  writeFileSync(filePath, JSON.stringify(session.toJSON(), null, 2), "utf8");
  return filePath;
}

export function loadSessionFromFile(filePath) {
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  return payload;
}

export function resolveLatestSessionPath(workspaceRoot) {
  const primaryDir = ensureSessionsDir(workspaceRoot);
  const files = [];

  for (const directory of [primaryDir, legacySessionsDir(workspaceRoot)]) {
    if (!existsSync(directory)) {
      continue;
    }

    files.push(
      ...readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(directory, name)),
    );
  }

  files.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  return files[0] ?? null;
}

export function resolveResumePath(workspaceRoot, resume) {
  if (!resume) {
    return null;
  }

  if (resume === "latest") {
    return resolveLatestSessionPath(workspaceRoot);
  }

  if (path.isAbsolute(resume)) {
    return existsSync(resume) ? resume : sessionFilePath(workspaceRoot, resume);
  }

  const workspaceRelativePath = path.resolve(workspaceRoot, resume);
  if (existsSync(workspaceRelativePath)) {
    return workspaceRelativePath;
  }

  const dclawRelativePath = path.resolve(resolveDclawRoot(workspaceRoot), resume);
  if (existsSync(dclawRelativePath)) {
    return dclawRelativePath;
  }

  for (const directory of [ensureSessionsDir(workspaceRoot), legacySessionsDir(workspaceRoot)]) {
    const candidatePath = path.join(directory, `${resume}.json`);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return sessionFilePath(workspaceRoot, resume);
}
