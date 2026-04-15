import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadLocalEnv } from "../src/config/load-env.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-load-env-tests");
const originalEnv = {
  LESSON13_ENV_ROOT: process.env.LESSON13_ENV_ROOT,
  LESSON13_ENV_DCLAW: process.env.LESSON13_ENV_DCLAW,
  DCLAW_HOME: process.env.DCLAW_HOME,
};

afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

test("loadLocalEnv reads lesson13 .dclaw/.env.local when present", async () => {
  const envDir = path.join(tempRoot, ".dclaw");
  await mkdir(envDir, { recursive: true });
  await writeFile(
    path.join(envDir, ".env.local"),
    "LESSON13_ENV_DCLAW=loaded-from-dclaw\n",
    "utf8",
  );

  delete process.env.LESSON13_ENV_DCLAW;
  loadLocalEnv(tempRoot);

  assert.equal(process.env.LESSON13_ENV_DCLAW, "loaded-from-dclaw");
});

test("loadLocalEnv reads DCLAW_HOME/.env.local when publishing to a user-level home", async () => {
  const publishedHome = path.join(tempRoot, "published-home");
  await mkdir(publishedHome, { recursive: true });
  await writeFile(
    path.join(publishedHome, ".env.local"),
    "LESSON13_ENV_DCLAW=loaded-from-dclaw-home\n",
    "utf8",
  );

  process.env.DCLAW_HOME = publishedHome;
  delete process.env.LESSON13_ENV_DCLAW;
  loadLocalEnv(tempRoot);

  assert.equal(process.env.LESSON13_ENV_DCLAW, "loaded-from-dclaw-home");
});

test("loadLocalEnv still reads workspace .env.local and keeps it authoritative", async () => {
  await mkdir(path.join(tempRoot, ".dclaw"), { recursive: true });
  await writeFile(path.join(tempRoot, ".env.local"), "LESSON13_ENV_ROOT=from-root\n", "utf8");
  await writeFile(
    path.join(tempRoot, ".dclaw", ".env.local"),
    "LESSON13_ENV_ROOT=from-dclaw\n",
    "utf8",
  );

  delete process.env.LESSON13_ENV_ROOT;
  loadLocalEnv(tempRoot);

  assert.equal(process.env.LESSON13_ENV_ROOT, "from-root");
});
