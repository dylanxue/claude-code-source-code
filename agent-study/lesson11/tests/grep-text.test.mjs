import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { grepSearchTool, grepTextTool } from "../src/tools/grep-text.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".tmp-grep-text-tests");
const originalEnv = {
  GREP_TEXT_MAX_MATCHES: process.env.GREP_TEXT_MAX_MATCHES,
  GREP_TEXT_MAX_FILE_BYTES: process.env.GREP_TEXT_MAX_FILE_BYTES,
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

test("grep_search returns claw-code style filenames for files_with_matches mode", async () => {
  setEnv();
  const targetDir = path.join(tempRoot, "src");
  await mkdir(targetDir, { recursive: true });
  const fileA = path.join(targetDir, "a.js");
  const fileB = path.join(targetDir, "b.js");
  await writeFile(fileA, "const alpha = 1;\n", "utf8");
  await writeFile(fileB, "const beta = 2;\n", "utf8");

  const result = await grepSearchTool.execute(
    {
      pattern: "alpha",
      path: path.relative(workspaceRoot, targetDir),
      output_mode: "files_with_matches",
    },
    { workspaceRoot },
  );

  assert.equal(result.mode, "files_with_matches");
  assert.equal(result.numFiles, 1);
  assert.deepEqual(result.filenames, [fileA]);
  assert.equal(result.content, null);
  assert.equal(result.numMatches, null);
  assert.equal(result.appliedLimit, null);
  assert.equal(result.appliedOffset, null);
});

test("grep_text alias returns the same claw-code style payload shape", async () => {
  setEnv();
  const targetDir = path.join(tempRoot, "alias");
  await mkdir(targetDir, { recursive: true });
  const fileA = path.join(targetDir, "a.js");
  await writeFile(fileA, "const alpha = 1;\n", "utf8");

  const result = await grepTextTool.execute(
    {
      pattern: "alpha",
      path: path.relative(workspaceRoot, targetDir),
      output_mode: "files_with_matches",
    },
    { workspaceRoot },
  );

  assert.equal(result.mode, "files_with_matches");
  assert.equal(result.numFiles, 1);
  assert.deepEqual(result.filenames, [fileA]);
  assert.equal(result.content, null);
  assert.equal(result.numMatches, null);
});

test("grep_search returns claw-code style content mode fields", async () => {
  setEnv();
  const targetDir = path.join(tempRoot, "content");
  await mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, "demo.rs");
  await writeFile(filePath, "fn main() {\n println!(\"hello\");\n}\n", "utf8");

  const result = await grepSearchTool.execute(
    {
      pattern: "hello",
      path: path.relative(workspaceRoot, targetDir),
      glob: "**/*.rs",
      output_mode: "content",
      head_limit: 10,
      offset: 0,
    },
    { workspaceRoot },
  );

  assert.equal(result.mode, "content");
  assert.equal(result.numFiles, 1);
  assert.deepEqual(result.filenames, [filePath]);
  assert.equal(typeof result.content, "string");
  assert.equal(result.content.includes(`${filePath}:2:`), true);
  assert.equal(result.numLines, 1);
  assert.equal(result.numMatches, null);
});

test("grep_search supports claw-code flag aliases for context, line numbers, type, and case-insensitive matching", async () => {
  setEnv();
  const targetDir = path.join(tempRoot, "flags");
  await mkdir(targetDir, { recursive: true });
  const rustFile = path.join(targetDir, "demo.rs");
  const jsFile = path.join(targetDir, "demo.js");
  await writeFile(rustFile, "fn main() {\n let alpha = 1;\n let beta = 2;\n}\n", "utf8");
  await writeFile(jsFile, "const ALPHA = 1;\n", "utf8");

  const result = await grepSearchTool.execute(
    {
      pattern: "alpha",
      path: path.relative(workspaceRoot, targetDir),
      output_mode: "content",
      "-C": 1,
      "-n": true,
      "-i": true,
      type: "rs",
    },
    { workspaceRoot },
  );

  assert.equal(result.mode, "content");
  assert.equal(result.numFiles, 1);
  assert.deepEqual(result.filenames, [rustFile]);
  assert.match(result.content, new RegExp(`${rustFile}:1:`));
  assert.match(result.content, new RegExp(`${rustFile}:2:`));
  assert.match(result.content, new RegExp(`${rustFile}:3:`));
  assert.equal(result.numLines, 3);
});

test("grep_search returns count mode fields and limit metadata", async () => {
  setEnv({
    GREP_TEXT_MAX_MATCHES: 10,
  });
  const targetDir = path.join(tempRoot, "count");
  await mkdir(targetDir, { recursive: true });
  const fileA = path.join(targetDir, "a.txt");
  const fileB = path.join(targetDir, "b.txt");
  await writeFile(fileA, "alpha\nalpha\n", "utf8");
  await writeFile(fileB, "alpha\n", "utf8");

  const result = await grepSearchTool.execute(
    {
      pattern: "alpha",
      path: path.relative(workspaceRoot, targetDir),
      output_mode: "count",
      head_limit: 1,
      offset: 1,
    },
    { workspaceRoot },
  );

  assert.equal(result.mode, "count");
  assert.equal(result.numMatches, 3);
  assert.equal(result.numFiles, 1);
  assert.deepEqual(result.filenames, [fileB]);
  assert.equal(result.appliedLimit, null);
  assert.equal(result.appliedOffset, 1);
});

test("grep_search rejects paths that escape the workspace boundary", async () => {
  setEnv();
  await mkdir(tempRoot, { recursive: true });
  const outsideRoot = path.join(workspaceRoot, ".tmp-grep-text-outside");
  await mkdir(outsideRoot, { recursive: true });

  await assert.rejects(
    () =>
      grepSearchTool.execute(
        {
          pattern: "alpha",
          path: "../.tmp-grep-text-outside",
        },
        { workspaceRoot: tempRoot },
      ),
    /Path escapes workspace boundary/,
  );

  await rm(outsideRoot, { recursive: true, force: true });
});
