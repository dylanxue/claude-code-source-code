import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function createTraceLogger(workspaceRoot) {
  const logsDir = path.resolve(workspaceRoot, ".logs");
  mkdirSync(logsDir, { recursive: true });

  const timestamp = timestampForFilename();
  const logPath = path.join(logsDir, `llm-trace-${timestamp}.log`);
  const summaryPath = path.join(logsDir, `run-summary-${timestamp}.log`);

  return {
    logPath,
    summaryPath,
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
  };
}
