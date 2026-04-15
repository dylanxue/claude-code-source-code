import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { writeFileTool } from "../src/tools/write-file.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-write-file-tests");
const originalEnv = {
  WRITE_FILE_MAX_BYTES: process.env.WRITE_FILE_MAX_BYTES,
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

test("write_file returns claw-code style create metadata for new files", async () => {
  setEnv();
  const relativePath = path.join(".tmp-write-file-tests", "create.txt");

  const result = await writeFileTool.execute(
    {
      path: relativePath,
      content: "alpha\nbeta\n",
    },
    { workspaceRoot },
  );

  const written = await readFile(path.join(workspaceRoot, relativePath), "utf8");
  assert.equal(written, "alpha\nbeta\n");
  assert.equal(result.type, "create");
  assert.equal(result.filePath, path.join(workspaceRoot, relativePath));
  assert.equal(result.originalFile, null);
  assert.equal(result.gitDiff, null);
  assert.equal(result.structuredPatch[0]?.oldLines, 0);
  assert.equal(result.structuredPatch[0]?.newLines, 2);
});

test("write_file returns claw-code style update metadata for existing files", async () => {
  setEnv();
  const relativePath = path.join(".tmp-write-file-tests", "update.txt");

  await writeFileTool.execute(
    {
      path: relativePath,
      content: "alpha\nbeta\nalpha\n",
    },
    { workspaceRoot },
  );

  const result = await writeFileTool.execute(
    {
      path: relativePath,
      content: "omega\n",
    },
    { workspaceRoot },
  );

  const written = await readFile(path.join(workspaceRoot, relativePath), "utf8");
  assert.equal(written, "omega\n");
  assert.equal(result.type, "update");
  assert.equal(result.originalFile, "alpha\nbeta\nalpha\n");
  assert.equal(result.structuredPatch[0]?.oldLines, 3);
  assert.equal(result.structuredPatch[0]?.newLines, 1);
});

test("write_file rejects oversized content like claw-code file_ops", async () => {
  setEnv({
    WRITE_FILE_MAX_BYTES: 8,
  });

  await assert.rejects(
    () =>
      writeFileTool.execute(
        {
          path: path.join(".tmp-write-file-tests", "oversized.txt"),
          content: "alpha beta alpha\n",
        },
        { workspaceRoot },
      ),
    /content is too large \(17 bytes, max 8 bytes\)/,
  );
});

test("write_file rejects paths that escape the workspace boundary", async () => {
  setEnv();
  await mkdir(tempRoot, { recursive: true });
  const outsideRoot = path.join(workspaceRoot, ".tmp-write-file-outside");
  await mkdir(outsideRoot, { recursive: true });

  await assert.rejects(
    () =>
      writeFileTool.execute(
        {
          path: "../.tmp-write-file-outside/outside.txt",
          content: "unsafe content",
        },
        { workspaceRoot: tempRoot },
      ),
    /Path escapes workspace boundary/,
  );

  await rm(outsideRoot, { recursive: true, force: true });
});

test("write_file can ignore the workspace boundary via config", async () => {
  setEnv({
    TOOLS_IGNORE_WORKSPACE_BOUNDARY: "true",
  });
  const nestedWorkspace = path.join(tempRoot, "workspace", "pkg");
  const outsideRoot = path.join(tempRoot, "outside");
  const outsideFile = path.join(outsideRoot, "outside.txt");
  await mkdir(nestedWorkspace, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });

  const result = await writeFileTool.execute(
    {
      path: "../../outside/outside.txt",
      content: "unsafe but configured\n",
    },
    { workspaceRoot: nestedWorkspace },
  );

  const written = await readFile(outsideFile, "utf8");
  assert.equal(written, "unsafe but configured\n");
  assert.equal(result.filePath, outsideFile);
});
