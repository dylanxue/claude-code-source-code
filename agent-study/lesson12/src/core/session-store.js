import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

function timestampId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createSessionId() {
  return `session-${timestampId()}`;
}

export function ensureSessionsDir(workspaceRoot) {
  const sessionsDir = path.resolve(workspaceRoot, ".sessions");
  mkdirSync(sessionsDir, { recursive: true });
  return sessionsDir;
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
  const sessionsDir = ensureSessionsDir(workspaceRoot);
  const files = readdirSync(sessionsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(sessionsDir, name))
    .sort((left, right) => {
      return statSync(right).mtimeMs - statSync(left).mtimeMs;
    });

  return files[0] ?? null;
}

export function resolveResumePath(workspaceRoot, resume) {
  if (!resume) {
    return null;
  }

  if (resume === "latest") {
    return resolveLatestSessionPath(workspaceRoot);
  }

  const absolutePath = path.isAbsolute(resume) ? resume : path.resolve(workspaceRoot, resume);
  return existsSync(absolutePath) ? absolutePath : sessionFilePath(workspaceRoot, resume);
}
