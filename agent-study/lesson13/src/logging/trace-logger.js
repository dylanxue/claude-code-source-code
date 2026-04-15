import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { resolveWorkspaceScopedDclawChildPath } from "../config/dclaw-paths.js";

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function createRunId() {
  const timestamp = timestampForFilename();
  const suffix = Math.random().toString(16).slice(2, 8);
  return `run-${timestamp}-${suffix}`;
}

export function createTraceLogger(workspaceRoot) {
  const logsDir = resolveWorkspaceScopedDclawChildPath(workspaceRoot, "logs");
  mkdirSync(logsDir, { recursive: true });

  const runId = createRunId();
  const logPath = path.join(logsDir, `llm-trace-${runId}.log`);
  const summaryPath = path.join(logsDir, `run-summary-${runId}.log`);
  const cliLogPath = path.join(logsDir, `cli-run-${runId}.log`);

  appendFileSync(logPath, `run_id=${runId}\nlog_type=llm_trace\n\n`, "utf8");
  appendFileSync(summaryPath, `run_id=${runId}\nlog_type=run_summary\n\n`, "utf8");
  appendFileSync(cliLogPath, `run_id=${runId}\nlog_type=cli_run\n\n`, "utf8");

  return {
    runId,
    logPath,
    summaryPath,
    cliLogPath,
    write(title, payload) {
      const rendered = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
      const chunk = [
        "",
        `===== ${title} =====`,
        rendered,
        `===== END ${title} =====`,
        "",
      ].join("\n");
      appendFileSync(logPath, chunk, "utf8");
    },
    writeSummary(title, payload) {
      const rendered = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
      const chunk = [
        "",
        `===== ${title} =====`,
        rendered,
        `===== END ${title} =====`,
        "",
      ].join("\n");
      appendFileSync(summaryPath, chunk, "utf8");
    },
    writeCli(line) {
      appendFileSync(cliLogPath, line, "utf8");
    },
  };
}
