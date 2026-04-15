import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { readFileTool } from "../src/tools/read-file.js";

const workspaceRoot = process.cwd();
const originalEnv = {
  READ_FILE_MAX_BYTES: process.env.READ_FILE_MAX_BYTES,
  READ_FILE_MAX_FILE_BYTES: process.env.READ_FILE_MAX_FILE_BYTES,
  READ_FILE_MAX_WINDOW_FILE_BYTES: process.env.READ_FILE_MAX_WINDOW_FILE_BYTES,
  READ_FILE_MAX_WINDOW_LINES: process.env.READ_FILE_MAX_WINDOW_LINES,
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

test("read_file returns line-window metadata for normal window reads", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1_000_000,
    READ_FILE_MAX_WINDOW_LINES: 50,
  });

  const result = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 5, limit: 12 },
    { workspaceRoot },
  );

  assert.equal(result.type, "text");
  assert.equal(result.file.startLine, 6);
  assert.equal(result.file.numLines, 12);
  assert.equal(result.file.totalLines >= 12, true);
  assert.equal(result.file.filePath.endsWith("src/tools/grep-text.js"), true);
  assert.equal(typeof result.file.content, "string");
});

test("read_file uses a default window limit even when limit is omitted", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1_000_000,
    READ_FILE_MAX_WINDOW_LINES: 12,
  });

  const result = await readFileTool.execute(
    { path: "src/tools/grep-text.js" },
    { workspaceRoot },
  );

  assert.equal(result.type, "text");
  assert.equal(result.file.startLine, 1);
  assert.equal(result.file.numLines, 12);
});

test("read_file applies the same file-size cap to omitted-limit reads and explicit window reads", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 100,
    READ_FILE_MAX_WINDOW_LINES: 50,
  });

  const fullRead = await readFileTool.execute(
    { path: "src/tools/grep-text.js" },
    { workspaceRoot },
  );
  assert.equal(fullRead.reason, "file_too_large");
  assert.equal(fullRead.skipped, true);

  const windowRead = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 10, limit: 8 },
    { workspaceRoot },
  );
  assert.equal(windowRead.reason, "file_too_large");
  assert.equal(windowRead.skipped, true);
});

test("read_file clamps oversized limits and reports factual clamp metadata", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1_000_000,
    READ_FILE_MAX_WINDOW_LINES: 20,
  });

  const result = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 0, limit: 9999 },
    { workspaceRoot },
  );

  assert.equal(result.type, "text");
  assert.equal(result.file.startLine, 1);
  assert.equal(result.file.numLines, 20);
});

test("read_file clamps invalid non-positive limits to a minimum valid window size", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1_000_000,
    READ_FILE_MAX_WINDOW_LINES: 20,
  });

  const result = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 0, limit: 0 },
    { workspaceRoot },
  );

  assert.equal(result.type, "text");
  assert.equal(result.file.numLines, 1);
});

test("read_file applies a default window limit when offset is provided without limit", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1_000_000,
    READ_FILE_MAX_WINDOW_LINES: 15,
  });

  const result = await readFileTool.execute(
    { path: "src/tools/grep-text.js", offset: 10 },
    { workspaceRoot },
  );

  assert.equal(result.type, "text");
  assert.equal(result.file.startLine, 11);
  assert.equal(result.file.numLines, 15);
});

test("read_file rejects binary files like claw-code file_ops", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1_000_000,
  });
  const binaryPath = path.join(workspaceRoot, ".tmp-read-file-binary.bin");
  await writeFile(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x61]), "binary");

  await assert.rejects(
    () =>
      readFileTool.execute(
        { path: ".tmp-read-file-binary.bin" },
        { workspaceRoot },
      ),
    /file appears to be binary/,
  );

  await rm(binaryPath, { force: true });
});

test("read_file rejects paths that escape the workspace boundary", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1_000_000,
  });

  await assert.rejects(
    () =>
      readFileTool.execute(
        { path: "../README.md" },
        { workspaceRoot },
      ),
    /Path escapes workspace boundary/,
  );
});
