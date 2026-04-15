import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

import { listFilesTool } from "../src/tools/list-files.js";

const workspaceRoot = process.cwd();
const originalEnv = {
  LIST_FILES_MAX_ENTRIES: process.env.LIST_FILES_MAX_ENTRIES,
};

afterEach(() => {
  restoreEnv();
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
