import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { globSearchTool } from "../src/tools/glob-search.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-glob-search-tests");
const originalEnv = {
  GLOB_SEARCH_MAX_FILES: process.env.GLOB_SEARCH_MAX_FILES,
};

afterEach(async () => {
  restoreEnv();
  await rm(tempRoot, { recursive: true, force: true });
});

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

function setEnv(overrides = {}) {
  restoreEnv();
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = String(value);
  }
}

test("glob_search returns claw-code style absolute filenames", async () => {
  setEnv();
  const targetDir = path.join(tempRoot, "src");
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "a.js"), "a\n", "utf8");
  await writeFile(path.join(targetDir, "b.ts"), "b\n", "utf8");

  const result = await globSearchTool.execute(
    {
      pattern: "*.js",
      path: path.relative(workspaceRoot, targetDir),
    },
    { workspaceRoot },
  );

  assert.equal(result.numFiles, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.filenames[0], path.join(targetDir, "a.js"));
});

test("glob_search truncates to the configured max files and sorts by modified time", async () => {
  setEnv({
    GLOB_SEARCH_MAX_FILES: 2,
  });
  const targetDir = path.join(tempRoot, "sorted");
  await mkdir(targetDir, { recursive: true });
  const olderPath = path.join(targetDir, "older.js");
  const newerPath = path.join(targetDir, "newer.js");
  const newestPath = path.join(targetDir, "newest.js");
  await writeFile(olderPath, "older\n", "utf8");
  await writeFile(newerPath, "newer\n", "utf8");
  await writeFile(newestPath, "newest\n", "utf8");

  const now = new Date();
  await utimes(olderPath, now, new Date(now.getTime() - 3_000));
  await utimes(newerPath, now, new Date(now.getTime() - 2_000));
  await utimes(newestPath, now, new Date(now.getTime() - 1_000));

  const result = await globSearchTool.execute(
    {
      pattern: "*.js",
      path: path.relative(workspaceRoot, targetDir),
    },
    { workspaceRoot },
  );

  assert.equal(result.numFiles, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.filenames, [newestPath, newerPath]);
});

test("glob_search rejects paths that escape the workspace boundary", async () => {
  setEnv();
  await mkdir(tempRoot, { recursive: true });
  const outsideRoot = path.join(workspaceRoot, ".tmp-glob-search-outside");
  await mkdir(outsideRoot, { recursive: true });

  await assert.rejects(
    () =>
      globSearchTool.execute(
        {
          pattern: "*.js",
          path: "../.tmp-glob-search-outside",
        },
        { workspaceRoot: tempRoot },
      ),
    /Path escapes workspace boundary/,
  );

  await rm(outsideRoot, { recursive: true, force: true });
});
