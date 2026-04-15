import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

import { AgentRuntime } from "../src/core/agent-runtime.js";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { bashTool } from "../src/tools/bash.js";

const workspaceRoot = process.cwd();
const originalEnv = {
  BASH_MAX_OUTPUT_CHARS: process.env.BASH_MAX_OUTPUT_CHARS,
  READ_FILE_MAX_BYTES: process.env.READ_FILE_MAX_BYTES,
  BASH_SANDBOX_ENABLED: process.env.BASH_SANDBOX_ENABLED,
  BASH_SANDBOX_NAMESPACE_RESTRICTIONS: process.env.BASH_SANDBOX_NAMESPACE_RESTRICTIONS,
  BASH_SANDBOX_ISOLATE_NETWORK: process.env.BASH_SANDBOX_ISOLATE_NETWORK,
  BASH_SANDBOX_FILESYSTEM_MODE: process.env.BASH_SANDBOX_FILESYSTEM_MODE,
  BASH_SANDBOX_ALLOWED_MOUNTS: process.env.BASH_SANDBOX_ALLOWED_MOUNTS,
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

test("bash reports timeout like claw-code bash", async () => {
  const result = await bashTool.execute(
    {
      command: 'node -e "setTimeout(() => console.log(\'late\'), 500)"',
      timeout: 50,
    },
    { workspaceRoot },
  );

  assert.equal(result.interrupted, true);
  assert.equal(result.returnCodeInterpretation, "timeout");
  assert.match(result.stderr, /Command exceeded timeout of 50 ms/);
  assert.equal(result.noOutputExpected, true);
});

test("bash reports non-zero exits with returnCodeInterpretation", async () => {
  const result = await bashTool.execute(
    {
      command: 'printf "oops\\n" >&2; exit 7',
    },
    { workspaceRoot },
  );

  assert.equal(result.interrupted, false);
  assert.equal(result.returnCodeInterpretation, "exit_code:7");
  assert.match(result.stderr, /oops/);
});

test("bash reports successful output like claw-code bash", async () => {
  const result = await bashTool.execute(
    {
      command: 'printf "hello"',
    },
    { workspaceRoot },
  );

  assert.equal(result.stdout, "hello");
  assert.equal(result.interrupted, false);
  assert.equal(result.returnCodeInterpretation, null);
});

test("bash applies filesystem sandbox env vars during foreground execution", async () => {
  const result = await bashTool.execute(
    {
      command: 'node -p "JSON.stringify({home: process.env.HOME, tmpdir: process.env.TMPDIR})"',
    },
    { workspaceRoot },
  );

  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.home, path.join(workspaceRoot, ".sandbox-home"));
  assert.equal(parsed.tmpdir, path.join(workspaceRoot, ".sandbox-tmp"));
});

test("bash can launch a detached background command", async () => {
  const result = await bashTool.execute(
    {
      command: 'node -e "setTimeout(() => {}, 200)"',
      run_in_background: true,
    },
    { workspaceRoot },
  );

  assert.equal(typeof result.backgroundTaskId, "string");
  assert.equal(result.noOutputExpected, true);
  assert.equal(result.backgroundedByUser, false);
});

test("bash reports claw-code style sandboxStatus defaults", async () => {
  const result = await bashTool.execute(
    {
      command: 'printf "hello"',
    },
    { workspaceRoot },
  );

  assert.equal(result.sandboxStatus.enabled, true);
  assert.equal(result.sandboxStatus.requested.enabled, true);
  assert.equal(result.sandboxStatus.requested.namespace_restrictions, true);
  assert.equal(result.sandboxStatus.requested.network_isolation, false);
  assert.equal(result.sandboxStatus.requested.filesystem_mode, "workspace-only");
  assert.deepEqual(result.sandboxStatus.requested.allowed_mounts, []);
  assert.deepEqual(result.sandboxStatus.allowed_mounts, []);
});

test("bash resolves default sandbox config from environment", async () => {
  setEnv({
    BASH_SANDBOX_ENABLED: "false",
    BASH_SANDBOX_NAMESPACE_RESTRICTIONS: "false",
    BASH_SANDBOX_ISOLATE_NETWORK: "true",
    BASH_SANDBOX_FILESYSTEM_MODE: "allow-list",
    BASH_SANDBOX_ALLOWED_MOUNTS: ["logs", "/tmp"].join(path.delimiter),
  });

  const result = await bashTool.execute(
    {
      command: 'printf "hello"',
    },
    { workspaceRoot },
  );

  assert.equal(result.sandboxStatus.enabled, false);
  assert.equal(result.sandboxStatus.requested.enabled, false);
  assert.equal(result.sandboxStatus.requested.namespace_restrictions, false);
  assert.equal(result.sandboxStatus.requested.network_isolation, true);
  assert.equal(result.sandboxStatus.requested.filesystem_mode, "allow-list");
  assert.deepEqual(result.sandboxStatus.requested.allowed_mounts, ["logs", "/tmp"]);
});

test("bash input overrides environment-backed sandbox defaults", async () => {
  setEnv({
    BASH_SANDBOX_ENABLED: "true",
    BASH_SANDBOX_NAMESPACE_RESTRICTIONS: "true",
    BASH_SANDBOX_ISOLATE_NETWORK: "false",
    BASH_SANDBOX_FILESYSTEM_MODE: "workspace-only",
    BASH_SANDBOX_ALLOWED_MOUNTS: ["logs"].join(path.delimiter),
  });

  const result = await bashTool.execute(
    {
      command: 'printf "hello"',
      dangerouslyDisableSandbox: true,
      namespaceRestrictions: false,
      isolateNetwork: true,
      filesystemMode: "off",
      allowedMounts: ["tmp"],
    },
    { workspaceRoot },
  );

  assert.equal(result.sandboxStatus.enabled, false);
  assert.equal(result.sandboxStatus.requested.enabled, false);
  assert.equal(result.sandboxStatus.requested.namespace_restrictions, false);
  assert.equal(result.sandboxStatus.requested.network_isolation, true);
  assert.equal(result.sandboxStatus.requested.filesystem_mode, "off");
  assert.deepEqual(result.sandboxStatus.requested.allowed_mounts, ["tmp"]);
});

test("bash normalizes sandbox allow-list mounts and can disable sandbox", async () => {
  const result = await bashTool.execute(
    {
      command: 'printf "hello"',
      dangerouslyDisableSandbox: true,
      namespaceRestrictions: false,
      isolateNetwork: false,
      filesystemMode: "allow-list",
      allowedMounts: ["logs", "/tmp"],
    },
    { workspaceRoot },
  );

  assert.equal(result.dangerouslyDisableSandbox, true);
  assert.equal(result.sandboxStatus.enabled, false);
  assert.equal(result.sandboxStatus.filesystem_active, false);
  assert.equal(result.sandboxStatus.requested.filesystem_mode, "allow-list");
  assert.deepEqual(result.sandboxStatus.requested.allowed_mounts, ["logs", "/tmp"]);
  assert.deepEqual(result.sandboxStatus.allowed_mounts, [path.join(workspaceRoot, "logs"), "/tmp"]);
  assert.equal(result.sandboxStatus.fallback_reason, null);
});

test("bash does not override filesystem sandbox env vars when sandbox is disabled", async () => {
  const result = await bashTool.execute(
    {
      command: 'node -p "JSON.stringify({home: process.env.HOME, tmpdir: process.env.TMPDIR})"',
      dangerouslyDisableSandbox: true,
      filesystemMode: "workspace-only",
    },
    { workspaceRoot },
  );

  const parsed = JSON.parse(result.stdout.trim());
  assert.notEqual(parsed.home, path.join(workspaceRoot, ".sandbox-home"));
  assert.notEqual(parsed.tmpdir, path.join(workspaceRoot, ".sandbox-tmp"));
});

test("bash keeps the direct file dump guardrail in lesson10", async () => {
  setEnv({
    READ_FILE_MAX_BYTES: 1,
  });

  const result = await bashTool.execute(
    {
      command: "cat package.json",
    },
    { workspaceRoot },
  );

  assert.equal(result.guard?.reason, "file_too_large_for_direct_shell_dump");
  assert.equal(result.interrupted, false);
});

test("runtime blocks obvious bash reads outside the workspace boundary", () => {
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(bashTool);

  const runtime = new AgentRuntime({
    session: new Session(),
    model: {},
    toolRegistry,
    systemPrompt: "test",
    workspaceRoot,
  });

  const blocked = runtime.findBlockedToolCall({
    toolName: "bash",
    input: { command: "cat ../package.json" },
  });

  assert.equal(blocked?.guardrail?.kind, "block_workspace_escape_path_access");
  assert.equal(blocked?.guardrail?.path, "../package.json");
});

test("runtime keeps workspace-local bash probes allowed", () => {
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(bashTool);

  const runtime = new AgentRuntime({
    session: new Session(),
    model: {},
    toolRegistry,
    systemPrompt: "test",
    workspaceRoot,
  });

  const blocked = runtime.findBlockedToolCall({
    toolName: "bash",
    input: { command: "ls src" },
  });

  assert.equal(blocked, null);
});
