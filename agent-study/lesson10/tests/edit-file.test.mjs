import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { editFileTool } from "../src/tools/edit-file.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-edit-file-tests");
const originalEnv = {
  EDIT_FILE_MAX_BYTES: process.env.EDIT_FILE_MAX_BYTES,
  EDIT_FILE_BINARY_PROBE_BYTES: process.env.EDIT_FILE_BINARY_PROBE_BYTES,
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

async function createFixture(relativePath, content) {
  const targetPath = path.join(tempRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return path.relative(workspaceRoot, targetPath);
}

test("edit_file replaces the first matching occurrence by default", async () => {
  setEnv();
  const relativePath = await createFixture("replace-once.txt", "alpha beta alpha\n");

  const result = await editFileTool.execute(
    {
      path: relativePath,
      old_string: "alpha",
      new_string: "omega",
    },
    { workspaceRoot },
  );

  const updated = await readFile(path.join(workspaceRoot, relativePath), "utf8");
  assert.equal(updated, "omega beta alpha\n");
  assert.equal(result.replaceAll, false);
  assert.equal(result.oldString, "alpha");
  assert.equal(result.newString, "omega");
  assert.equal(result.originalFile, "alpha beta alpha\n");
  assert.equal(result.filePath, path.join(workspaceRoot, relativePath));
  assert.equal(result.gitDiff, null);
  assert.equal(Array.isArray(result.structuredPatch), true);
  assert.equal(result.structuredPatch[0]?.oldStart, 1);
});

test("edit_file can replace all matching occurrences", async () => {
  setEnv();
  const relativePath = await createFixture("replace-all.txt", "alpha beta alpha\n");

  const result = await editFileTool.execute(
    {
      path: relativePath,
      old_string: "alpha",
      new_string: "omega",
      replace_all: true,
    },
    { workspaceRoot },
  );

  const updated = await readFile(path.join(workspaceRoot, relativePath), "utf8");
  assert.equal(updated, "omega beta omega\n");
  assert.equal(result.replaceAll, true);
});

test("edit_file rejects requests when old_string is not found", async () => {
  setEnv();
  const relativePath = await createFixture("missing.txt", "alpha beta alpha\n");

  await assert.rejects(
    () =>
      editFileTool.execute(
        {
          path: relativePath,
          old_string: "gamma",
          new_string: "omega",
        },
        { workspaceRoot },
      ),
    /old_string not found in file/,
  );
});

test("edit_file rejects empty old_string", async () => {
  setEnv();
  const relativePath = await createFixture("empty-old.txt", "alpha beta alpha\n");

  await assert.rejects(
    () =>
      editFileTool.execute(
        {
          path: relativePath,
          old_string: "",
          new_string: "omega",
        },
        { workspaceRoot },
      ),
    /old_string must not be empty/,
  );
});

test("edit_file rejects paths that escape the workspace boundary", async () => {
  setEnv();
  await mkdir(tempRoot, { recursive: true });
  const outsideRoot = path.join(workspaceRoot, ".tmp-edit-file-outside");
  await mkdir(outsideRoot, { recursive: true });
  const outsidePath = path.join(outsideRoot, "outside.txt");
  await writeFile(outsidePath, "alpha beta alpha\n", "utf8");

  await assert.rejects(
    () =>
      editFileTool.execute(
        {
          path: "../.tmp-edit-file-outside/outside.txt",
          old_string: "alpha",
          new_string: "omega",
        },
        { workspaceRoot: tempRoot },
      ),
    /Path escapes workspace boundary/,
  );

  await rm(outsideRoot, { recursive: true, force: true });
});

test("edit_file rejects binary files like claw-code file_ops", async () => {
  setEnv();
  const targetPath = path.join(tempRoot, "binary.bin");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x61, 0x62]), "binary");

  await assert.rejects(
    () =>
      editFileTool.execute(
        {
          path: path.relative(workspaceRoot, targetPath),
          old_string: "a",
          new_string: "b",
        },
        { workspaceRoot },
      ),
    /file appears to be binary/,
  );
});

test("edit_file rejects oversized files using claw-code style write-size limits", async () => {
  setEnv({
    EDIT_FILE_MAX_BYTES: 8,
  });
  const relativePath = await createFixture("oversized.txt", "alpha beta alpha\n");

  await assert.rejects(
    () =>
      editFileTool.execute(
        {
          path: relativePath,
          old_string: "alpha",
          new_string: "omega",
        },
        { workspaceRoot },
      ),
    /file exceeds maximum editable size of 8 bytes/,
  );
});
