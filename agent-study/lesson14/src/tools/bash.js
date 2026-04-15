import { execFile, spawn } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { shouldIgnoreWorkspaceBoundary } from "./file-ops.js";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_OUTPUT_BYTES = 16_384;
let cachedUnshareSupportPromise = null;

function positiveNumberOrNull(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

function parseBooleanEnv(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function defaultBashConfig() {
  return {
    maxOutputBytes: positiveNumberOrNull(process.env.BASH_MAX_OUTPUT_CHARS) ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxBufferBytes: positiveNumberOrNull(process.env.BASH_MAX_BUFFER_BYTES) ?? 1024 * 1024,
    fileReadGuardMaxBytes: Number(
      process.env.BASH_FILE_READ_GUARD_MAX_BYTES ??
        process.env.READ_FILE_MAX_BYTES ??
        process.env.READ_FILE_MAX_FILE_BYTES ??
        10 * 1024 * 1024,
    ),
  };
}

function defaultSandboxConfig() {
  return {
    enabled: parseBooleanEnv(process.env.BASH_SANDBOX_ENABLED, true),
    namespace_restrictions: parseBooleanEnv(
      process.env.BASH_SANDBOX_NAMESPACE_RESTRICTIONS,
      true,
    ),
    network_isolation: parseBooleanEnv(process.env.BASH_SANDBOX_ISOLATE_NETWORK, false),
    filesystem_mode: normalizeFilesystemMode(process.env.BASH_SANDBOX_FILESYSTEM_MODE),
    allowed_mounts: normalizeRequestedAllowedMounts(
      process.env.BASH_SANDBOX_ALLOWED_MOUNTS?.split(path.delimiter).filter(Boolean) ?? [],
    ),
  };
}

function assertSafeCommand(command) {
  const blockedFragments = ["rm -rf", "git reset --hard", "shutdown", "reboot", ":(){:|:&};:"];

  for (const fragment of blockedFragments) {
    if (command.includes(fragment)) {
      throw new Error(`Blocked command fragment detected: ${fragment}`);
    }
  }
}

function firstDefined(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function normalizeTimeout(input) {
  return positiveNumberOrNull(input?.timeout ?? input?.timeoutMs);
}

function shouldRunInBackground(input) {
  return input?.run_in_background === true || input?.background === true;
}

function truncateOutput(text, maxOutputBytes) {
  const normalized = String(text ?? "");
  if (Buffer.byteLength(normalized, "utf8") <= maxOutputBytes) {
    return normalized;
  }

  let end = Math.min(normalized.length, maxOutputBytes);
  while (end > 0 && Buffer.byteLength(normalized.slice(0, end), "utf8") > maxOutputBytes) {
    end -= 1;
  }

  return `${normalized.slice(0, end)}\n\n[output truncated — exceeded ${maxOutputBytes} bytes]`;
}

function normalizeFilesystemMode(mode) {
  return ["off", "workspace-only", "allow-list"].includes(mode) ? mode : "workspace-only";
}

function normalizeRequestedAllowedMounts(mounts) {
  if (!Array.isArray(mounts)) {
    return [];
  }

  return mounts.map((mount) => String(mount)).filter(Boolean);
}

function tryRealpathSync(targetPath) {
  try {
    return realpathSync(targetPath);
  } catch {
    return null;
  }
}

function isPathInsideWorkspaceSync(workspaceRoot, inputPath) {
  const workspaceRealPath = tryRealpathSync(workspaceRoot) ?? path.resolve(workspaceRoot);
  const candidatePath = path.resolve(workspaceRoot, inputPath);
  const targetPath = tryRealpathSync(candidatePath) ?? candidatePath;
  const relativeToWorkspace = path.relative(workspaceRealPath, targetPath);

  return !(
    relativeToWorkspace === ".." ||
    relativeToWorkspace.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToWorkspace)
  );
}

function normalizeStatusAllowedMounts(workspaceRoot, mounts) {
  return mounts.map((mount) =>
    path.isAbsolute(mount) ? mount : path.join(workspaceRoot, mount),
  );
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command) {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return false;
  }

  for (const segment of pathValue.split(path.delimiter)) {
    if (!segment) {
      continue;
    }

    try {
      await access(path.join(segment, command), fsConstants.X_OK);
      return true;
    } catch {
      // keep probing PATH entries
    }
  }

  return false;
}

function detectContainerMarkersFromEnv() {
  const markers = [];
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    if (
      ["container", "docker", "podman", "kubernetes_service_host"].includes(normalized) &&
      value
    ) {
      markers.push(`env:${key}=${value}`);
    }
  }

  return markers;
}

async function detectContainerEnvironment() {
  const markers = [...detectContainerMarkersFromEnv()];

  if (await pathExists("/.dockerenv")) {
    markers.push("/.dockerenv");
  }

  if (await pathExists("/run/.containerenv")) {
    markers.push("/run/.containerenv");
  }

  const cgroup = await readFile("/proc/1/cgroup", "utf8").catch(() => null);
  if (typeof cgroup === "string") {
    for (const needle of ["docker", "containerd", "kubepods", "podman", "libpod"]) {
      if (cgroup.includes(needle)) {
        markers.push(`/proc/1/cgroup:${needle}`);
      }
    }
  }

  const uniqueMarkers = [...new Set(markers)].sort();
  return {
    in_container: uniqueMarkers.length > 0,
    container_markers: uniqueMarkers,
  };
}

async function unshareUserNamespaceWorks() {
  if (process.platform !== "linux") {
    return false;
  }

  if (!cachedUnshareSupportPromise) {
    cachedUnshareSupportPromise = (async () => {
      if (!(await commandExists("unshare"))) {
        return false;
      }

      try {
        await execFileAsync("unshare", ["--user", "--map-root-user", "true"], {
          timeout: 1000,
          maxBuffer: 64 * 1024,
        });
        return true;
      } catch {
        return false;
      }
    })();
  }

  return cachedUnshareSupportPromise;
}

async function buildSandboxStatus(input, workspaceRoot) {
  const config = defaultSandboxConfig();
  const requestedAllowedMounts =
    input?.allowedMounts !== undefined
      ? normalizeRequestedAllowedMounts(input.allowedMounts)
      : config.allowed_mounts;
  const requested = {
    enabled:
      input?.dangerouslyDisableSandbox === true
        ? false
        : config.enabled,
    namespace_restrictions:
      input?.namespaceRestrictions ?? config.namespace_restrictions,
    network_isolation:
      input?.isolateNetwork ?? config.network_isolation,
    filesystem_mode:
      input?.filesystemMode !== undefined
        ? normalizeFilesystemMode(input.filesystemMode)
        : config.filesystem_mode,
    allowed_mounts: requestedAllowedMounts,
  };
  const [namespaceSupported, container] = await Promise.all([
    unshareUserNamespaceWorks(),
    detectContainerEnvironment(),
  ]);
  const networkSupported = namespaceSupported;
  const filesystemActive = requested.enabled && requested.filesystem_mode !== "off";
  const fallbackReasons = [];

  if (requested.enabled && requested.namespace_restrictions && !namespaceSupported) {
    fallbackReasons.push("namespace isolation unavailable (requires Linux with `unshare`)");
  }
  if (requested.enabled && requested.network_isolation && !networkSupported) {
    fallbackReasons.push("network isolation unavailable (requires Linux with `unshare`)");
  }
  if (
    requested.enabled &&
    requested.filesystem_mode === "allow-list" &&
    requested.allowed_mounts.length === 0
  ) {
    fallbackReasons.push("filesystem allow-list requested without configured mounts");
  }

  const allowedMounts = normalizeStatusAllowedMounts(workspaceRoot, requested.allowed_mounts);
  const active =
    requested.enabled &&
    (!requested.namespace_restrictions || namespaceSupported) &&
    (!requested.network_isolation || networkSupported);

  return {
    enabled: requested.enabled,
    requested,
    supported: namespaceSupported,
    active,
    namespace_supported: namespaceSupported,
    namespace_active: requested.enabled && requested.namespace_restrictions && namespaceSupported,
    network_supported: networkSupported,
    network_active: requested.enabled && requested.network_isolation && networkSupported,
    filesystem_mode: requested.filesystem_mode,
    filesystem_active: filesystemActive,
    allowed_mounts: allowedMounts,
    in_container: container.in_container,
    container_markers: container.container_markers,
    fallback_reason: fallbackReasons.length > 0 ? fallbackReasons.join("; ") : null,
  };
}

function buildLinuxSandboxLauncher(command, workspaceRoot, sandboxStatus) {
  if (
    process.platform !== "linux" ||
    !sandboxStatus.enabled ||
    (!sandboxStatus.namespace_active && !sandboxStatus.network_active)
  ) {
    return null;
  }

  const args = [
    "--user",
    "--map-root-user",
    "--mount",
    "--ipc",
    "--pid",
    "--uts",
    "--fork",
  ];
  if (sandboxStatus.network_active) {
    args.push("--net");
  }
  args.push("sh", "-lc", command);

  const envOverrides = {
    CLAWD_SANDBOX_FILESYSTEM_MODE: sandboxStatus.filesystem_mode,
    CLAWD_SANDBOX_ALLOWED_MOUNTS: sandboxStatus.allowed_mounts.join(":"),
  };

  return {
    program: "unshare",
    args,
    env: envOverrides,
  };
}

async function prepareCommandExecution(command, workspaceRoot, sandboxStatus) {
  const launcher = buildLinuxSandboxLauncher(command, workspaceRoot, sandboxStatus);
  if (launcher) {
    return {
      program: launcher.program,
      args: launcher.args,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ...launcher.env,
      },
    };
  }

  return {
    program: "sh",
    args: ["-lc", command],
    cwd: workspaceRoot,
    env: { ...process.env },
  };
}

async function buildBashResult(
  input,
  sandboxStatus,
  {
    stdout = "",
    stderr = "",
    interrupted = false,
    backgroundTaskId = null,
    backgroundedByUser = null,
    assistantAutoBackgrounded = null,
    returnCodeInterpretation = null,
    noOutputExpected = null,
    guard = null,
  } = {},
) {
  return {
    stdout,
    stderr,
    rawOutputPath: null,
    interrupted,
    isImage: null,
    backgroundTaskId,
    backgroundedByUser,
    assistantAutoBackgrounded,
    dangerouslyDisableSandbox: input?.dangerouslyDisableSandbox ?? null,
    returnCodeInterpretation,
    noOutputExpected,
    structuredContent: null,
    persistedOutputPath: null,
    persistedOutputSize: null,
    sandboxStatus,
    ...(guard ? { guard } : {}),
  };
}

function extractDirectFileDumpDescriptor(command) {
  const normalized = String(command ?? "").trim();
  const patterns = [
    {
      mode: "cat",
      regex: /^\s*cat\s+(?:--\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "head",
      regex:
        /^\s*head\s+(?:-[A-Za-z]\s+)*(?:-n\s+\d+\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "head_numeric",
      regex:
        /^\s*head\s+-\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail",
      regex:
        /^\s*tail\s+(?:-[A-Za-z]\s+)*(?:-n\s+\d+\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail_numeric",
      regex:
        /^\s*tail\s+-\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail_from_line",
      regex:
        /^\s*tail\s+-n\s+\+\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "tail_then_head",
      regex:
        /^\s*tail\s+-n\s+\+\d+\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*\|\s*head\s+-\d+\s*$/,
    },
    {
      mode: "wc_then_head",
      regex:
        /^\s*wc\s+-l\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*&&\s*head\s+-\d+\s+(?:"[^"]+"|'[^']+'|[^\s|><;&]+)\s*$/,
    },
    {
      mode: "wc_then_sed",
      regex:
        /^\s*wc\s+-l\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*&&\s*sed\s+-n\s+(?:"[^"]+"|'[^']+')\s+(?:"[^"]+"|'[^']+'|[^\s|><;&]+)\s*$/,
    },
    {
      mode: "sed_print",
      regex:
        /^\s*sed\s+-n\s+(?:"[^"]+"|'[^']+')\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "node_read_file_sync",
      regex:
        /^\s*node\s+-e\s+(?:"[^"]*readFileSync\(\s*'([^']+)'\s*,[^"]*"|'[^']*readFileSync\(\s*"([^"]+)"\s*,[^']*')\s*$/,
    },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const targetPath = firstDefined(match[1], match[2], match[3]);
      if (targetPath) {
        return {
          mode: pattern.mode,
          path: targetPath,
        };
      }
    }
  }

  return null;
}

function extractPathProbeDescriptor(command) {
  const normalized = String(command ?? "").trim();
  const patterns = [
    {
      mode: "ls",
      regex:
        /^\s*ls\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "find",
      regex:
        /^\s*find\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))(?:\s+.*)?$/,
    },
    {
      mode: "stat",
      regex:
        /^\s*stat\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "wc_lines",
      regex:
        /^\s*wc\s+-l\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "file",
      regex:
        /^\s*file\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "realpath",
      regex:
        /^\s*realpath\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "readlink",
      regex:
        /^\s*readlink\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "grep_file",
      regex:
        /^\s*grep\s+(?:-[A-Za-z]+\s+)*(?:"[^"]+"|'[^']+'|[^\s|><;&]+)\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
    {
      mode: "rg_path",
      regex:
        /^\s*rg\s+(?:-[A-Za-z]+\s+)*(?:"[^"]+"|'[^']+'|[^\s|><;&]+)\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))\s*$/,
    },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const targetPath = firstDefined(match[1], match[2], match[3]);
      if (targetPath) {
        return {
          mode: pattern.mode,
          path: targetPath,
        };
      }
    }
  }

  return null;
}

function classifyBashCall(input) {
  const command = String(input?.command ?? "").trim();
  const directFileDump = extractDirectFileDumpDescriptor(command);
  if (directFileDump) {
    return {
      callKind: "direct_file_dump",
      targetPath: directFileDump.path,
      targetMode: directFileDump.mode,
    };
  }

  const pathProbe = extractPathProbeDescriptor(command);
  if (pathProbe) {
    return {
      callKind: "path_probe",
      targetPath: pathProbe.path,
      targetMode: pathProbe.mode,
    };
  }

  if (/\b(wc\s+-l|grep\s+-n|rg\b|stat\b|ls\s+-l)\b/.test(command)) {
    return {
      callKind: "metadata_query",
      targetPath: null,
      targetMode: null,
    };
  }

  return {
    callKind: "other",
    targetPath: null,
    targetMode: null,
  };
}

function blockDirectFileDumpFollowUp({ descriptor, activeGuardrails = [] }) {
  for (const guardrail of activeGuardrails) {
    if (guardrail?.kind !== "block_direct_file_dump_follow_up") {
      continue;
    }

    if (
      descriptor.callKind === "direct_file_dump" &&
      typeof descriptor.targetPath === "string" &&
      descriptor.targetPath === guardrail.path
    ) {
      return {
        decision: "block",
        hookName: "direct_file_dump_guardrail",
        guardrail,
        summary:
          "A deterministic pre-tool-use hook blocked this follow-up because it attempted a known high-cost broad file dump.",
      };
    }
  }

  return null;
}

function blockWorkspaceEscapePathAccess({ descriptor, toolCall, workspaceRoot }) {
  if (toolCall.toolName !== "bash" || !workspaceRoot) {
    return null;
  }

  if (shouldIgnoreWorkspaceBoundary()) {
    return null;
  }

  if (!["direct_file_dump", "path_probe"].includes(descriptor.callKind)) {
    return null;
  }

  if (typeof descriptor.targetPath !== "string" || descriptor.targetPath.length === 0) {
    return null;
  }

  if (isPathInsideWorkspaceSync(workspaceRoot, descriptor.targetPath)) {
    return null;
  }

  return {
    decision: "block",
    hookName: "workspace_boundary_guardrail",
    guardrail: {
      kind: "block_workspace_escape_path_access",
      path: descriptor.targetPath,
      sourceTool: "bash",
    },
    summary:
      "A deterministic pre-tool-use hook blocked this bash call because it attempted to read or probe a path outside the workspace boundary.",
  };
}

async function maybeGuardDirectFileDump(input, workspaceRoot, config) {
  const descriptor = extractDirectFileDumpDescriptor(input.command);
  if (!descriptor) {
    return null;
  }

  const resolvedPath = path.resolve(workspaceRoot, descriptor.path);
  const fileStat = await stat(resolvedPath).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }

  if (!(config.fileReadGuardMaxBytes > 0) || fileStat.size <= config.fileReadGuardMaxBytes) {
    return null;
  }

  const sandboxStatus = await buildSandboxStatus(input, workspaceRoot);
  return buildBashResult(input, sandboxStatus, {
    stdout: "",
    stderr: "",
    interrupted: false,
    returnCodeInterpretation: null,
    noOutputExpected: true,
    guard: {
      blocked: true,
      reason: "file_too_large_for_direct_shell_dump",
      mode: descriptor.mode,
      filePath: descriptor.path,
      fileBytes: fileStat.size,
      maxFileBytes: config.fileReadGuardMaxBytes,
      suggestedTool: "read_file",
    },
  });
}

function makeNoOutputExpected(stdout, stderr) {
  return stdout.trim().length === 0 && stderr.trim().length === 0;
}

export const bashTool = {
  name: "bash",
  family: "shell",
  describeCall(input) {
    return classifyBashCall(input);
  },
  preToolUseHooks: [blockDirectFileDumpFollowUp, blockWorkspaceEscapePathAccess],
  description: "Execute a shell command in the current workspace.",
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
      timeout: { type: "integer", minimum: 1 },
      description: { type: "string" },
      run_in_background: { type: "boolean" },
      dangerouslyDisableSandbox: { type: "boolean" },
      namespaceRestrictions: { type: "boolean" },
      isolateNetwork: { type: "boolean" },
      filesystemMode: {
        type: "string",
        enum: ["off", "workspace-only", "allow-list"],
      },
      allowedMounts: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  async execute(input, context) {
    const config = defaultBashConfig();
    assertSafeCommand(input.command);
    const sandboxStatus = await buildSandboxStatus(input, context.workspaceRoot);

    const guardedResult = await maybeGuardDirectFileDump(input, context.workspaceRoot, config);
    if (guardedResult) {
      return guardedResult;
    }

    if (shouldRunInBackground(input)) {
      const prepared = await prepareCommandExecution(
        input.command,
        context.workspaceRoot,
        sandboxStatus,
      );
      const child = spawn(prepared.program, prepared.args, {
        cwd: prepared.cwd,
        env: prepared.env,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      return buildBashResult(input, sandboxStatus, {
        stdout: "",
        stderr: "",
        interrupted: false,
        backgroundTaskId: child.pid ? String(child.pid) : null,
        backgroundedByUser: false,
        assistantAutoBackgrounded: false,
        returnCodeInterpretation: null,
        noOutputExpected: true,
      });
    }

    const timeoutMs = normalizeTimeout(input);

    try {
      const prepared = await prepareCommandExecution(
        input.command,
        context.workspaceRoot,
        sandboxStatus,
      );
      const { stdout, stderr } = await execFileAsync(prepared.program, prepared.args, {
        cwd: prepared.cwd,
        env: prepared.env,
        timeout: timeoutMs ?? undefined,
        maxBuffer: config.maxBufferBytes,
      });
      const truncatedStdout = truncateOutput(stdout, config.maxOutputBytes);
      const truncatedStderr = truncateOutput(stderr, config.maxOutputBytes);

      return buildBashResult(input, sandboxStatus, {
        stdout: truncatedStdout,
        stderr: truncatedStderr,
        interrupted: false,
        returnCodeInterpretation: null,
        noOutputExpected: makeNoOutputExpected(truncatedStdout, truncatedStderr),
      });
    } catch (error) {
      const timedOut =
        timeoutMs !== null &&
        (error?.killed === true ||
          error?.signal === "SIGTERM" ||
          /timed? out/i.test(String(error?.message ?? "")));
      if (timedOut) {
        return buildBashResult(input, sandboxStatus, {
          stdout: "",
          stderr: `Command exceeded timeout of ${timeoutMs} ms`,
          interrupted: true,
          returnCodeInterpretation: "timeout",
          noOutputExpected: true,
        });
      }

      const stdout = truncateOutput(error?.stdout ?? "", config.maxOutputBytes);
      const stderr = truncateOutput(error?.stderr ?? error?.message ?? "", config.maxOutputBytes);
      const returnCodeInterpretation =
        typeof error?.code === "number" ? `exit_code:${error.code}` : null;

      return buildBashResult(input, sandboxStatus, {
        stdout,
        stderr,
        interrupted: false,
        returnCodeInterpretation,
        noOutputExpected: makeNoOutputExpected(stdout, stderr),
      });
    }
  },
};
