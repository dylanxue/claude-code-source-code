import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  resolveDclawRoot,
  resolveWorkspaceScopedDclawChildPath,
  workspaceFingerprint,
} from "../src/config/dclaw-paths.js";
import { ensureSessionsDir, sessionFilePath } from "../src/core/session-store.js";

const workspaceRoot = process.cwd();
const originalEnv = {
  DCLAW_HOME: process.env.DCLAW_HOME,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
});

test("resolveDclawRoot defaults to workspace .dclaw", () => {
  delete process.env.DCLAW_HOME;
  assert.equal(resolveDclawRoot(workspaceRoot), path.join(workspaceRoot, ".dclaw"));
});

test("resolveDclawRoot expands DCLAW_HOME under the user home directory", () => {
  process.env.DCLAW_HOME = "~/.dclaw";
  assert.equal(resolveDclawRoot(workspaceRoot), path.join(os.homedir(), ".dclaw"));
});

test("workspace fingerprint is deterministic and differs across workspaces", () => {
  const left = workspaceFingerprint("/tmp/lesson13-a");
  const right = workspaceFingerprint("/tmp/lesson13-b");

  assert.equal(left, workspaceFingerprint("/tmp/lesson13-a"));
  assert.equal(left.length, 16);
  assert.notEqual(left, right);
});

test("session storage now lives under .dclaw/sessions/<workspace-hash>", () => {
  delete process.env.DCLAW_HOME;
  const fingerprint = workspaceFingerprint(workspaceRoot);
  assert.equal(
    ensureSessionsDir(workspaceRoot),
    path.join(workspaceRoot, ".dclaw", "sessions", fingerprint),
  );
  assert.equal(
    sessionFilePath(workspaceRoot, "session-test"),
    path.join(workspaceRoot, ".dclaw", "sessions", fingerprint, "session-test.json"),
  );
});

test("log storage now lives under .dclaw/logs/<workspace-hash>", () => {
  delete process.env.DCLAW_HOME;
  const fingerprint = workspaceFingerprint(workspaceRoot);
  assert.equal(
    resolveWorkspaceScopedDclawChildPath(workspaceRoot, "logs"),
    path.join(workspaceRoot, ".dclaw", "logs", fingerprint),
  );
});
