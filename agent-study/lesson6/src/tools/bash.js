import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function assertSafeCommand(command) {
  const blockedFragments = ["rm -rf", "git reset --hard", "shutdown", "reboot", ":(){:|:&};:"];

  for (const fragment of blockedFragments) {
    if (command.includes(fragment)) {
      throw new Error(`Blocked command fragment detected: ${fragment}`);
    }
  }
}

export const bashTool = {
  name: "bash",
  description: "Run a shell command in the workspace with basic safety checks.",
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
    },
  },
  async execute(input, context) {
    assertSafeCommand(input.command);

    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", input.command], {
        cwd: context.workspaceRoot,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });

      return {
        command: input.command,
        exitCode: 0,
        stdout: stdout.trim().slice(0, 4000),
        stderr: stderr.trim().slice(0, 4000),
      };
    } catch (error) {
      return {
        command: input.command,
        exitCode: error.code ?? 1,
        stdout: error.stdout?.trim().slice(0, 4000) ?? "",
        stderr: error.stderr?.trim().slice(0, 4000) ?? error.message,
      };
    }
  },
};
