import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { listFilesTool } from "../src/tools/list-files.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-list-files-tests");
const originalEnv = {
  LIST_FILES_MAX_ENTRIES: process.env.LIST_FILES_MAX_ENTRIES,
  TOOLS_IGNORE_WORKSPACE_BOUNDARY: process.env.TOOLS_IGNORE_WORKSPACE_BOUNDARY,
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

test("list_files returns sorted entries and factual truncation counts", async () => {
  setEnv({
    LIST_FILES_MAX_ENTRIES: 3,
  });

  const result = await listFilesTool.execute(
    { path: "src/tools" },
    { workspaceRoot },
  );

  assert.equal(result.path, "src/tools");
  assert.equal(result.returnedEntryCount, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.omittedEntryCount, result.totalEntryCount - result.returnedEntryCount);

  const sortedNames = [...result.entries].map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    sortedNames,
  );
});

test("list_files rejects paths that escape the workspace boundary", async () => {
  await assert.rejects(
    () =>
      listFilesTool.execute(
        { path: "../" },
        { workspaceRoot },
      ),
    /Path escapes workspace boundary/,
  );
});

test("list_files can ignore the workspace boundary via config", async () => {
  setEnv({
    TOOLS_IGNORE_WORKSPACE_BOUNDARY: "true",
  });
  const nestedWorkspace = path.join(tempRoot, "workspace", "pkg");
  const outsideDir = path.join(tempRoot, "outside");
  await mkdir(nestedWorkspace, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(outsideDir, "visible.txt"), "hello\n", "utf8");

  const result = await listFilesTool.execute(
    { path: "../../outside" },
    { workspaceRoot: nestedWorkspace },
  );

  assert.equal(result.path, "../../outside");
  assert.equal(result.entries.some((entry) => entry.name === "visible.txt"), true);
});
